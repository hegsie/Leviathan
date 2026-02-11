/**
 * Workspace Service
 * Manages multi-repository workspaces via Tauri commands
 */

import { invokeCommand } from './tauri-api.ts';
import { showToast } from './notification.service.ts';
import type { Workspace, WorkspaceRepoStatus } from '../types/git.types.ts';
import type { CommandResult } from '../types/api.types.ts';

export async function getWorkspaces(): Promise<CommandResult<Workspace[]>> {
  return invokeCommand<Workspace[]>('get_workspaces');
}

export async function getWorkspace(workspaceId: string): Promise<CommandResult<Workspace>> {
  return invokeCommand<Workspace>('get_workspace', { workspaceId });
}

export async function saveWorkspace(workspace: Workspace): Promise<CommandResult<Workspace>> {
  const result = await invokeCommand<Workspace>('save_workspace', { workspace });
  if (result.success) {
    showToast('Workspace saved', 'success');
  }
  return result;
}

export async function deleteWorkspace(workspaceId: string): Promise<CommandResult<void>> {
  const result = await invokeCommand<void>('delete_workspace', { workspaceId });
  if (result.success) {
    showToast('Workspace deleted', 'success');
  }
  return result;
}

export async function addRepositoryToWorkspace(
  workspaceId: string,
  path: string,
  name: string,
): Promise<CommandResult<Workspace>> {
  return invokeCommand<Workspace>('add_repository_to_workspace', {
    workspaceId,
    path,
    name,
  });
}

export async function removeRepositoryFromWorkspace(
  workspaceId: string,
  path: string,
): Promise<CommandResult<Workspace>> {
  return invokeCommand<Workspace>('remove_repository_from_workspace', {
    workspaceId,
    path,
  });
}

export async function updateWorkspaceLastOpened(workspaceId: string): Promise<CommandResult<void>> {
  return invokeCommand<void>('update_workspace_last_opened', { workspaceId });
}

export async function validateWorkspaceRepositories(
  workspaceId: string,
): Promise<CommandResult<WorkspaceRepoStatus[]>> {
  return invokeCommand<WorkspaceRepoStatus[]>('validate_workspace_repositories', {
    workspaceId,
  });
}
