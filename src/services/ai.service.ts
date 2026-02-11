/**
 * AI Service
 * Provides AI-powered commit message generation via configurable providers
 */

import { invokeCommand } from './tauri-api.ts';
import type { CommandResult } from '../types/api.types.ts';

/**
 * AI provider types
 */
export type AiProviderType = 'ollama' | 'lm_studio' | 'openai' | 'anthropic' | 'github_copilot' | 'google_gemini';

/**
 * AI provider information
 */
export interface AiProviderInfo {
  providerType: AiProviderType;
  name: string;
  available: boolean;
  requiresApiKey: boolean;
  hasApiKey: boolean;
  endpoint: string;
  models: string[];
  selectedModel: string | null;
}

/**
 * Generated commit message result
 */
export interface GeneratedCommitMessage {
  summary: string;
  body: string | null;
}

/**
 * AI-generated conflict resolution suggestion
 */
export interface ConflictResolutionSuggestion {
  resolvedContent: string;
  explanation: string;
}

/**
 * Get all AI providers with their status
 */
export async function getAiProviders(): Promise<CommandResult<AiProviderInfo[]>> {
  return invokeCommand<AiProviderInfo[]>('get_ai_providers');
}

/**
 * Get the currently active AI provider
 */
export async function getActiveAiProvider(): Promise<CommandResult<AiProviderType | null>> {
  return invokeCommand<AiProviderType | null>('get_active_ai_provider');
}

/**
 * Set the active AI provider
 */
export async function setAiProvider(
  providerType: AiProviderType
): Promise<CommandResult<void>> {
  return invokeCommand<void>('set_ai_provider', { providerType });
}

/**
 * Set API key for a provider
 */
export async function setAiApiKey(
  providerType: AiProviderType,
  apiKey: string | null
): Promise<CommandResult<void>> {
  return invokeCommand<void>('set_ai_api_key', { providerType, apiKey });
}

/**
 * Set the model for a provider
 */
export async function setAiModel(
  providerType: AiProviderType,
  model: string | null
): Promise<CommandResult<void>> {
  return invokeCommand<void>('set_ai_model', { providerType, model });
}

/**
 * Test if a provider is available
 */
export async function testAiProvider(
  providerType: AiProviderType
): Promise<CommandResult<boolean>> {
  return invokeCommand<boolean>('test_ai_provider', { providerType });
}

/**
 * Auto-detect available local AI providers (Ollama, LM Studio)
 */
export async function autoDetectAiProviders(): Promise<CommandResult<AiProviderType[]>> {
  return invokeCommand<AiProviderType[]>('auto_detect_ai_providers');
}

/**
 * Generate a commit message from staged changes
 */
export async function generateCommitMessage(
  repoPath: string
): Promise<CommandResult<GeneratedCommitMessage>> {
  return invokeCommand<GeneratedCommitMessage>('generate_commit_message', {
    repoPath,
  });
}

/**
 * Suggest a conflict resolution using AI
 */
export async function suggestConflictResolution(
  filePath: string,
  oursContent: string,
  theirsContent: string,
  baseContent?: string,
  contextBefore?: string,
  contextAfter?: string,
): Promise<CommandResult<ConflictResolutionSuggestion>> {
  return invokeCommand<ConflictResolutionSuggestion>('suggest_conflict_resolution', {
    filePath,
    oursContent,
    theirsContent,
    baseContent: baseContent ?? null,
    contextBefore: contextBefore ?? null,
    contextAfter: contextAfter ?? null,
  });
}

/**
 * Check if AI is available (provider configured and working)
 */
export async function isAiAvailable(): Promise<boolean> {
  const result = await invokeCommand<boolean>('is_ai_available');
  return result.success && result.data === true;
}

/**
 * Get display name for a provider type
 */
export function getProviderDisplayName(providerType: AiProviderType): string {
  switch (providerType) {
    case 'ollama':
      return 'Ollama';
    case 'lm_studio':
      return 'LM Studio';
    case 'openai':
      return 'OpenAI';
    case 'anthropic':
      return 'Anthropic Claude';
    case 'github_copilot':
      return 'GitHub Models';
    case 'google_gemini':
      return 'Google Gemini';
  }
}

/**
 * Check if a provider requires an API key
 */
export function providerRequiresApiKey(providerType: AiProviderType): boolean {
  return providerType === 'openai' || providerType === 'anthropic' || providerType === 'github_copilot' || providerType === 'google_gemini';
}
