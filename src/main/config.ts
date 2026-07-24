import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface VozzaConfig {
  openaiApiKey: string;
  shortcut: string;
  language: string;
}

const DEFAULTS: VozzaConfig = {
  openaiApiKey: '',
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

  const merged = { ...DEFAULTS, ...stored };
  // Em desenvolvimento, uma chave no .env serve de fallback quando ainda não
  // foi salva nenhuma no app.
  if (!merged.openaiApiKey && process.env.OPENAI_API_KEY) {
    merged.openaiApiKey = process.env.OPENAI_API_KEY;
  }
  return merged;
}

export function saveConfig(partial: Partial<VozzaConfig>): VozzaConfig {
  const current = loadConfig();
  const next = { ...current, ...partial };
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf-8');
  return next;
}

export function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 12) return '••••';
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}
