import { pool } from './db';

/**
 * Registro de eventos de produto — a matéria-prima do funil no /admin.
 *
 * Regra inegociável de privacidade: **nunca** guardar conteúdo. Nada de
 * áudio, texto ditado, e-mail ou o que a pessoa escreveu. Só o nome do passo
 * e metadados de lista fechada (código de erro, modo escolhido, faixa de
 * duração). Se um valor não estiver na allowlist abaixo, ele é descartado.
 */

/** Eventos que o servidor emite sozinho — chegam mesmo sem cliente atualizado. */
export const SERVER_EVENTS = [
  'signup',
  'login',
  'dictation_ok',
  'dictation_error',
  'quota_blocked',
  'mode_denied',
  'checkout_started',
  'plan_activated',
  'plan_ended',
] as const;

/**
 * Eventos que só o cliente conhece (permissões, passos do onboarding, falha
 * ao colar). Allowlist explícita: qualquer nome fora dela é rejeitado, para o
 * endpoint público não virar depósito de lixo (ou de dado sensível).
 */
export const CLIENT_EVENTS = [
  'app_opened',
  'onboarding_started',
  'onboarding_account_created',
  'mic_permission_granted',
  'mic_permission_denied',
  'accessibility_granted',
  'accessibility_skipped',
  'onboarding_completed',
  'onboarding_abandoned',
  'dictation_started',
  'dictation_cancelled',
  'insertion_ok',
  'insertion_clipboard_only',
  'dictation_retried',
  'history_opened',
  'history_reinserted',
  'mode_changed',
  'shortcut_changed',
  'paywall_viewed',
  'upgrade_clicked',
] as const;

export type ClientEventName = (typeof CLIENT_EVENTS)[number];

const CLIENT_EVENT_SET = new Set<string>(CLIENT_EVENTS);
const PLATFORMS = new Set(['mac', 'extension', 'web']);

/** Chaves de props aceitas. Tudo fora daqui é jogado fora antes de gravar. */
const ALLOWED_PROP_KEYS = new Set([
  'error_code',
  'mode',
  'cycle',
  'plan',
  'duration_bucket',
  'words_bucket',
  'step',
  'reason',
  'app_version',
]);

/** Valores de prop viram string curta — corta qualquer tentativa de enfiar texto longo. */
function sanitizeProps(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!ALLOWED_PROP_KEYS.has(key)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === 'object') continue;
    out[key] = String(value).slice(0, 60);
  }
  return out;
}

export function isValidClientEvent(name: unknown): name is ClientEventName {
  return typeof name === 'string' && CLIENT_EVENT_SET.has(name);
}

export function normalizePlatform(raw: unknown): string | null {
  return typeof raw === 'string' && PLATFORMS.has(raw) ? raw : null;
}

/**
 * Escritas em voo. As rotas chamam `track` sem await (telemetria não pode
 * atrasar a resposta do usuário), então guardamos as promessas para quem
 * precisa esperar — os testes, que truncam as tabelas entre um caso e outro
 * e deadlockariam com um INSERT ainda pendente.
 */
const inFlight = new Set<Promise<void>>();

/**
 * Grava um evento. Nunca lança: telemetria quebrada não pode derrubar o
 * fluxo do usuário — no pior caso a gente perde uma linha de analytics.
 */
export function track(
  name: string,
  opts: { userId?: number | null; platform?: string | null; props?: unknown } = {},
): Promise<void> {
  const write = pool
    .query('INSERT INTO events (user_id, name, platform, props) VALUES ($1, $2, $3, $4)', [
      opts.userId ?? null,
      name,
      opts.platform ?? null,
      JSON.stringify(sanitizeProps(opts.props)),
    ])
    .then(
      () => undefined,
      (err) => {
        console.error('[vozza] falha ao gravar evento (ignorada):', err);
      },
    )
    .finally(() => inFlight.delete(write));

  inFlight.add(write);
  return write;
}

/** Espera as gravações pendentes. Só os testes precisam disso. */
export async function flushEvents(): Promise<void> {
  while (inFlight.size > 0) await Promise.all([...inFlight]);
}

/** Faixas em vez de números crus — suficiente para analisar, inútil para identificar alguém. */
export function wordsBucket(words: number): string {
  if (words <= 0) return '0';
  if (words <= 10) return '1-10';
  if (words <= 30) return '11-30';
  if (words <= 80) return '31-80';
  if (words <= 200) return '81-200';
  return '200+';
}
