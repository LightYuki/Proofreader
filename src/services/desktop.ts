import { invoke, isTauri } from '@tauri-apps/api/core';
import { open, save, confirm } from '@tauri-apps/plugin-dialog';
import type { AcceptedChange, BatchRequest, DocumentSession, ModelSettings, ModelSettingsInput, WorkspaceState } from '../types';

export const isDesktop = () => isTauri();

function requireDesktop() {
  if (!isDesktop()) throw new Error('请在桌面应用中使用此功能。');
}

export async function chooseJsonFile(title: string): Promise<string | null> {
  requireDesktop();
  return open({ title, multiple: false, directory: false, filters: [{ name: 'JSON 文件', extensions: ['json'] }] });
}

export async function chooseOutputPath(defaultPath: string): Promise<string | null> {
  requireDesktop();
  return save({ title: '保存', defaultPath, filters: [{ name: 'JSON 文件', extensions: ['json'] }] });
}

export async function confirmDiscard(message: string): Promise<boolean> {
  requireDesktop();
  return confirm(message, { title: '校润', kind: 'warning', okLabel: '继续', cancelLabel: '返回' });
}

export const desktop = {
  getSettings: () => invoke<ModelSettings>('get_settings'),
  resetSettings: () => invoke<ModelSettings>('reset_settings'),
  validateSettings: () => invoke<ModelSettings>('validate_settings'),
  saveSettings: (settings: ModelSettingsInput) => invoke<ModelSettings>('save_settings', { settings }),
  testConnection: (settings: ModelSettingsInput) => invoke<string>('test_connection', { settings }),
  listModels: (settings: ModelSettingsInput) => invoke<string[]>('list_models', { settings }),
  loadWorkspace: () => invoke<WorkspaceState>('load_workspace'),
  resetWorkspace: () => invoke<WorkspaceState>('reset_workspace'),
  saveWorkspace: (workspace: WorkspaceState) => invoke<void>('save_workspace', { workspace }),
  openDocuments: (sourcePath: string, targetPath: string) => invoke<DocumentSession>('open_documents', { sourcePath, targetPath }),
  saveDocument: (documentId: string, outputPath: string, changes: AcceptedChange[]) => invoke<string>('save_document', { documentId, outputPath, changes }),
  checkBatch: (request: BatchRequest) => invoke<string>('check_batch', { request }),
  cancelRequest: (requestId: string) => invoke<void>('cancel_request', { requestId }),
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : '操作失败，请重试。';
}
