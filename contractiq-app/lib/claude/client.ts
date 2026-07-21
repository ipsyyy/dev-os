import Anthropic from '@anthropic-ai/sdk'

export const CLAUDE_MODEL = 'claude-sonnet-5'

export function createClaudeClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
}
