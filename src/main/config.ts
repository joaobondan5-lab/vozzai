import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface VozzaConfig {
  authToken: string;
  userEmail: string;
  shortcut: string;
  language: string;
  /** Modo de escrita enviado ao servidor (ex.: padrao, whatsapp, email). */
  mode: string;
  /** false = novas transcrições não são guardadas no histórico local. */
  historyEnabled: boolean;
  /** true depois que o usuário concluiu um ditado real no onboarding. */
  onboardingDone: boolean;
}

const DEFAULTS: VozzaConfig = {
  authToken: '',
  userEmail: '',
  shortcut: 'CommandOrControl+Shift+Space',
  language: 'pt',
  mode: 'padrao',
  historyEnabled: true,
  onboardingDone: false,
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
  // Quem já usava o app antes do onboarding existir não deve ver o tour:
  // conta conectada = já passou pelo fluxo antigo e já ditou.
  if (stored.onboardingDone === undefined && merged.authToken) {
    merged.onboardingDone = true;
  }
  return merged;
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
