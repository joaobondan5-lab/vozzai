import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface VozzaConfig {
  authToken: string;
  userEmail: string;
  shortcut: string;
  language: string;
}

const DEFAULTS: VozzaConfig = {
  authToken: '',
  userEmail: '',
  shortcut: 'CommandOrControl+Shift+Space',
  language: 'pt',
};

function configPath(): string {
  return path.join(app.getPath('userData'), 'vozza-config.json');
}

export function loadConfig(): VozzaConfig {
  let stored: Partial<VozzaConfig> = {};
  try {
    const raw = fs.readFileSync(configPath(), 'utf-8');
    stored = JSON.parse(raw) as Partial<VozzaConfig>;
  } catch {
    stored = {};
  }
  return { ...DEFAULTS, ...stored };
}

export function saveConfig(partial: Partial<VozzaConfig>): VozzaConfig {
  const current = loadConfig();
  const next = { ...current, ...partial };
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf-8');
  return next;
}

export function clearAuth(): VozzaConfig {
  return saveConfig({ authToken: '', userEmail: '' });
}
