// Multi-key Secret Storage for VSIX Extension
// Uses VSCode SecretStorage to store multiple API keys

import * as vscode from 'vscode';

const SECRET_PREFIX = 'minimax.key.';

export interface StoredKey {
  id: string;
  name: string;
  key: string;
}

export class SecretStore {
  private secretStorage: vscode.SecretStorage;

  constructor(secretStorage: vscode.SecretStorage) {
    this.secretStorage = secretStorage;
  }

  private getKey(id: string): string {
    return `${SECRET_PREFIX}${id}`;
  }

  async saveKey(id: string, key: string): Promise<void> {
    await this.secretStorage.store(this.getKey(id), key);
  }

  async loadKey(id: string): Promise<string | undefined> {
    return this.secretStorage.get(this.getKey(id));
  }

  async deleteKey(id: string): Promise<void> {
    await this.secretStorage.delete(this.getKey(id));
  }

  async getAllKeys(ids: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    for (const id of ids) {
      const key = await this.secretStorage.get(this.getKey(id));
      if (key) {
        result.set(id, key);
      }
    }
    return result;
  }
}
