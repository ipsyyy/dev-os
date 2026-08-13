import { ClientSecretCredential } from '@azure/identity'
import { AIProjectClient } from '@azure/ai-projects'

export const AZURE_AGENT_NAME = process.env.AZURE_AGENT_NAME!

let cachedProject: AIProjectClient | null = null

function getProject(): AIProjectClient {
  if (!cachedProject) {
    const credential = new ClientSecretCredential(
      process.env.AZURE_TENANT_ID!,
      process.env.AZURE_CLIENT_ID!,
      process.env.AZURE_CLIENT_SECRET!
    )
    cachedProject = new AIProjectClient(process.env.AZURE_AGENT_ENDPOINT!, credential)
  }
  return cachedProject
}

export function createAzureAgentClient() {
  return getProject().getOpenAIClient()
}

export function agentReferenceBody() {
  return { agent_reference: { name: AZURE_AGENT_NAME, type: 'agent_reference' as const } }
}
