-- ============================================================================
-- ContractIQ — Supabase Schema
-- Paste-and-run in the Supabase SQL Editor on a fresh project.
-- Source: docs/engineering/engineering-doc.md §7 (Database Design and Schema)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Extensions
-- ----------------------------------------------------------------------------
create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- ----------------------------------------------------------------------------
-- Shared trigger function: auto-update `updated_at` on row modification
-- ----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ============================================================================
-- Table: contracts
-- ============================================================================
create table contracts (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  name              text not null,
  contract_type     text not null check (contract_type in ('NDA', 'MSA')),
  file_path         text,                          -- nullable: Storage path, null if Storage upload failed
  contract_text     text,                          -- nullable until upload/extraction succeeds
  page_count        int,
  status            text not null default 'uploaded'
                      check (status in ('uploaded', 'processing', 'completed', 'error')),
  error_message     text,
  last_accessed_at  timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_contracts_user_id on contracts(user_id);
create index idx_contracts_user_id_status on contracts(user_id, status);

create trigger trg_contracts_updated_at
  before update on contracts
  for each row execute function set_updated_at();

alter table contracts enable row level security;

create policy "contracts_select_own" on contracts
  for select using (user_id = auth.uid());
create policy "contracts_insert_own" on contracts
  for insert with check (user_id = auth.uid());
create policy "contracts_update_own" on contracts
  for update using (user_id = auth.uid());
create policy "contracts_delete_own" on contracts
  for delete using (user_id = auth.uid());

-- ============================================================================
-- Table: custom_key_terms
-- User's pre-processing request for extra terms (input, not extraction output).
-- ============================================================================
create table custom_key_terms (
  id            uuid primary key default gen_random_uuid(),
  contract_id   uuid not null references contracts(id) on delete cascade,
  term_name     text not null,
  created_at    timestamptz not null default now()
);

create index idx_custom_key_terms_contract_id on custom_key_terms(contract_id);

alter table custom_key_terms enable row level security;

create policy "custom_key_terms_select_own" on custom_key_terms
  for select using (
    exists (select 1 from contracts where contracts.id = custom_key_terms.contract_id and contracts.user_id = auth.uid())
  );
create policy "custom_key_terms_insert_own" on custom_key_terms
  for insert with check (
    exists (select 1 from contracts where contracts.id = custom_key_terms.contract_id and contracts.user_id = auth.uid())
  );
create policy "custom_key_terms_delete_own" on custom_key_terms
  for delete using (
    exists (select 1 from contracts where contracts.id = custom_key_terms.contract_id and contracts.user_id = auth.uid())
  );

-- ============================================================================
-- Table: key_terms
-- Every extracted term — standard and custom alike — for a contract.
-- ============================================================================
create table key_terms (
  id                uuid primary key default gen_random_uuid(),
  contract_id       uuid not null references contracts(id) on delete cascade,
  term_name         text not null,
  ai_value          text not null,
  current_value     text not null,
  page_number       int not null,
  confidence_score  numeric(5,2) not null check (confidence_score between 0 and 100),
  source_sentence   text not null,
  is_custom         boolean not null default false,
  is_edited         boolean not null default false,
  edited_at         timestamptz,
  created_at        timestamptz not null default now()
);

create index idx_key_terms_contract_id on key_terms(contract_id);

alter table key_terms enable row level security;

create policy "key_terms_select_own" on key_terms
  for select using (
    exists (select 1 from contracts where contracts.id = key_terms.contract_id and contracts.user_id = auth.uid())
  );
create policy "key_terms_insert_own" on key_terms
  for insert with check (
    exists (select 1 from contracts where contracts.id = key_terms.contract_id and contracts.user_id = auth.uid())
  );
create policy "key_terms_update_own" on key_terms
  for update using (
    exists (select 1 from contracts where contracts.id = key_terms.contract_id and contracts.user_id = auth.uid())
  );
create policy "key_terms_delete_own" on key_terms
  for delete using (
    exists (select 1 from contracts where contracts.id = key_terms.contract_id and contracts.user_id = auth.uid())
  );

-- ============================================================================
-- Table: chat_sessions
-- One session per contract at MVP, created lazily on first chat message.
-- ============================================================================
create table chat_sessions (
  id            uuid primary key default gen_random_uuid(),
  contract_id   uuid not null references contracts(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (contract_id)
);

create index idx_chat_sessions_contract_id on chat_sessions(contract_id);
create index idx_chat_sessions_user_id on chat_sessions(user_id);

create trigger trg_chat_sessions_updated_at
  before update on chat_sessions
  for each row execute function set_updated_at();

alter table chat_sessions enable row level security;

create policy "chat_sessions_select_own" on chat_sessions
  for select using (user_id = auth.uid());
create policy "chat_sessions_insert_own" on chat_sessions
  for insert with check (user_id = auth.uid());
create policy "chat_sessions_update_own" on chat_sessions
  for update using (user_id = auth.uid());

-- ============================================================================
-- Table: chat_messages
-- ============================================================================
create table chat_messages (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references chat_sessions(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null,
  page_citation   int,
  created_at      timestamptz not null default now()
);

create index idx_chat_messages_session_created on chat_messages(session_id, created_at);

alter table chat_messages enable row level security;

create policy "chat_messages_select_own" on chat_messages
  for select using (
    exists (select 1 from chat_sessions where chat_sessions.id = chat_messages.session_id and chat_sessions.user_id = auth.uid())
  );
create policy "chat_messages_insert_own" on chat_messages
  for insert with check (
    exists (select 1 from chat_sessions where chat_sessions.id = chat_messages.session_id and chat_sessions.user_id = auth.uid())
  );

-- ============================================================================
-- Table: user_feedback
-- ============================================================================
create table user_feedback (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  contract_id   uuid not null references contracts(id) on delete cascade,
  rating        text not null check (rating in ('up', 'down')),
  comment       text,
  created_at    timestamptz not null default now()
);

create index idx_user_feedback_contract_id on user_feedback(contract_id);

alter table user_feedback enable row level security;

create policy "user_feedback_select_own" on user_feedback
  for select using (user_id = auth.uid());
create policy "user_feedback_insert_own" on user_feedback
  for insert with check (user_id = auth.uid());

-- ============================================================================
-- View: term_corrections
-- Feeds the weekly correction-rate monitoring / ≤12%-in-7-days prompt review trigger.
-- Inherits RLS from key_terms and contracts via the underlying query.
-- ============================================================================
create view term_corrections as
select
  kt.contract_id,
  kt.id as key_term_id,
  kt.term_name,
  kt.ai_value,
  kt.current_value,
  kt.edited_at,
  c.user_id,
  c.contract_type
from key_terms kt
join contracts c on c.id = kt.contract_id
where kt.is_edited = true;

alter view term_corrections set (security_invoker = on);

-- ============================================================================
-- Storage: `contracts` bucket
-- Path convention: contracts/{user_id}/{contract_id}/{filename}.pdf
-- Private bucket; access only via 1-hour signed URLs issued server-side.
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contracts', 'contracts', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

create policy "contracts_storage_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'contracts'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "contracts_storage_select_own" on storage.objects
  for select using (
    bucket_id = 'contracts'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "contracts_storage_delete_own" on storage.objects
  for delete using (
    bucket_id = 'contracts'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ============================================================================
-- End of schema.
-- ============================================================================
