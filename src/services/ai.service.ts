/**
 * AI Service
 * Provides AI-powered commit message generation via Tauri commands
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invokeCommand } from './tauri-api.ts';
import type { CommandResult } from '../types/api.types.ts';

/**
 * AI model status information
 */
export interface AiModelStatus {
  modelAvailable: boolean;
  modelPath: string | null;
  modelSizeMb: number | null;
  quantization: string | null;
}

/**
 * Model download progress event
 */
export interface ModelDownloadProgress {
  downloadedBytes: number;
  totalBytes: number | null;
  progressPercent: number;
  status: 'downloading' | 'complete' | 'error';
}

/**
 * Generation progress event
 */
export interface GenerationProgress {
  status: 'loading_model' | 'generating' | 'complete' | 'error';
  tokensGenerated: number | null;
  message: string | null;
}

/**
 * Generated commit message result
 */
export interface GeneratedCommitMessage {
  summary: string;
  body: string | null;
  reasoning: string | null;
}

/**
 * Get AI model status
 */
export async function getAiStatus(): Promise<CommandResult<AiModelStatus>> {
  return invokeCommand<AiModelStatus>('get_ai_status');
}

/**
 * Check if AI features are available (model downloaded)
 */
export async function isAiAvailable(): Promise<boolean> {
  const result = await invokeCommand<boolean>('is_ai_available');
  return result.success && result.data === true;
}

/**
 * Download the AI model from HuggingFace
 */
export async function downloadAiModel(): Promise<CommandResult<void>> {
  return invokeCommand<void>('download_ai_model');
}

/**
 * Delete the AI model
 */
export async function deleteAiModel(): Promise<CommandResult<void>> {
  return invokeCommand<void>('delete_ai_model');
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
 * Subscribe to model download progress events
 */
export async function onModelDownloadProgress(
  handler: (progress: ModelDownloadProgress) => void
): Promise<UnlistenFn> {
  return listen<ModelDownloadProgress>('ai-model-download-progress', (event) => {
    handler(event.payload);
  });
}

/**
 * Subscribe to generation progress events
 */
export async function onGenerationProgress(
  handler: (progress: GenerationProgress) => void
): Promise<UnlistenFn> {
  return listen<GenerationProgress>('ai-generation-progress', (event) => {
    handler(event.payload);
  });
}
