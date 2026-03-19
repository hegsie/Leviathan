/**
 * Local AI Service
 * Manages local model inference, downloads, and system capabilities
 */

import { invokeCommand } from './tauri-api.ts';
import type { CommandResult } from '../types/api.types.ts';

/**
 * GPU vendor types
 */
export type GpuVendor = 'apple' | 'nvidia' | 'amd' | 'intel' | 'unknown';

/**
 * Model tier based on system capabilities
 */
export type ModelTier = 'ultra_light' | 'standard' | 'none';

/**
 * GPU information
 */
export interface GpuInfo {
  name: string;
  vendor: GpuVendor;
  vramBytes: number | null;
  metalSupported: boolean;
  cudaSupported: boolean;
}

/**
 * System capabilities for local AI
 */
export interface SystemCapabilities {
  totalRamBytes: number;
  availableRamBytes: number;
  gpuInfo: GpuInfo | null;
  recommendedTier: ModelTier;
  gpuAccelerationAvailable: boolean;
}

/**
 * Model entry from the registry
 */
export interface ModelEntry {
  id: string;
  displayName: string;
  hfRepo: string;
  hfFilename: string;
  sha256: string;
  sizeBytes: number;
  minRamBytes: number;
  tier: ModelTier;
  architecture: string;
  contextLength: number;
}

/**
 * Status of a local model
 */
export type ModelStatus = 'not_downloaded' | 'downloading' | 'downloaded' | 'loading' | 'ready' | 'error';

/**
 * Status of the local inference engine
 */
export type LocalModelStatus = 'unloaded' | 'loading' | 'ready' | 'error';

/**
 * Downloaded model information
 */
export interface DownloadedModel {
  id: string;
  displayName: string;
  sizeBytes: number;
  path: string;
  status: ModelStatus;
}

/**
 * Model download progress event payload
 */
export interface DownloadProgress {
  modelId: string;
  downloadedBytes: number;
  totalBytes: number;
  progressPercent: number;
}

/**
 * Get system capabilities (RAM, GPU, recommended tier)
 */
export async function getSystemCapabilities(): Promise<CommandResult<SystemCapabilities>> {
  return invokeCommand<SystemCapabilities>('get_system_capabilities');
}

/**
 * Get all available models from the registry
 */
export async function getAvailableModels(): Promise<CommandResult<ModelEntry[]>> {
  return invokeCommand<ModelEntry[]>('get_available_models');
}

/**
 * Get locally downloaded models
 */
export async function getDownloadedModels(): Promise<CommandResult<DownloadedModel[]>> {
  return invokeCommand<DownloadedModel[]>('get_downloaded_models');
}

/**
 * Start downloading a model (returns immediately, progress via events)
 */
export async function downloadModel(modelId: string): Promise<CommandResult<void>> {
  return invokeCommand<void>('download_model', { modelId });
}

/**
 * Cancel an in-progress model download
 */
export async function cancelModelDownload(modelId: string): Promise<CommandResult<void>> {
  return invokeCommand<void>('cancel_model_download', { modelId });
}

/**
 * Delete a downloaded model
 */
export async function deleteModel(modelId: string): Promise<CommandResult<void>> {
  return invokeCommand<void>('delete_model', { modelId });
}

/**
 * Get the current status of the local inference engine
 */
export async function getModelStatus(): Promise<CommandResult<LocalModelStatus>> {
  return invokeCommand<LocalModelStatus>('get_model_status');
}

/**
 * Get the display name of the currently loaded model, if any
 */
export async function getLoadedModelName(): Promise<CommandResult<string | null>> {
  return invokeCommand<string | null>('get_loaded_model_name');
}

/**
 * Get the recommended model based on system capabilities
 */
export async function getRecommendedModel(): Promise<CommandResult<ModelEntry | null>> {
  return invokeCommand<ModelEntry | null>('get_recommended_model');
}

/**
 * Load a downloaded model into the inference engine
 */
export async function loadModel(modelId: string): Promise<CommandResult<void>> {
  const result = await invokeCommand<void>('load_model', { modelId });
  if (result.success) {
    // Notify other components that AI is now available
    window.dispatchEvent(new CustomEvent('ai-settings-changed'));
  }
  return result;
}

/**
 * Unload the current local model from memory
 */
export async function unloadModel(): Promise<CommandResult<void>> {
  const result = await invokeCommand<void>('unload_model');
  if (result.success) {
    window.dispatchEvent(new CustomEvent('ai-settings-changed'));
  }
  return result;
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

/**
 * Get display name for a model tier
 */
export function getTierDisplayName(tier: ModelTier): string {
  switch (tier) {
    case 'ultra_light':
      return 'Ultra-Light (8GB+ RAM)';
    case 'standard':
      return 'Standard (16GB+ RAM)';
    case 'none':
      return 'Not Supported';
  }
}
