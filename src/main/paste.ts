import { clipboard, systemPreferences } from 'electron';
import { exec } from 'child_process';

export type PasteResult = 'pasted' | 'clipboard-only';

/**
 * Nome do app que estava em primeiro plano quando o ditado começou.
 *
 * Existe por causa de um efeito colateral do painel flutuante: pra aparecer
 * de verdade na tela (ver overlay.ts), o VozzAI precisa se auto-ativar com
 * `app.focus({steal:true})` — e isso tira o foco de quem quer que fosse o
 * app de destino. Sem devolver o foco antes do Cmd+V, o texto tentava colar
 * no próprio VozzAI (que não tem onde colar) em vez de voltar pro Chrome,
 * Excel, etc. de onde a pessoa ditou.
 */
export function captureFrontmostApp(): Promise<string | null> {
  return new Promise((resolve) => {
    if (process.platform !== 'darwin') return resolve(null);
    exec(
      `osascript -e 'tell application "System Events" to name of first application process whose frontmost is true'`,
      (err, stdout) => resolve(err ? null : stdout.trim() || null),
    );
  });
}

/**
 * Devolve o foco pro app capturado antes de colar.
 *
 * Passa por "System Events" (`set frontmost`) em vez de `tell application
 * "<nome>" to activate` de propósito: a segunda forma pede permissão de
 * Automação SEPARADA por app de destino — a primeira vez que a pessoa
 * ditasse no Chrome, depois no Excel, depois no Notion, cada um dispararia
 * seu próprio pedido do macOS. Via System Events é a MESMA permissão de
 * Acessibilidade que o Cmd+V já exige — uma perguntada só, nunca mais.
 */
export function activateApp(name: string): Promise<void> {
  return new Promise((resolve) => {
    const escaped = name.replace(/"/g, '\\"');
    exec(
      `osascript -e 'tell application "System Events" to set frontmost of (first process whose name is "${escaped}") to true'`,
      () => {
        // Pequena folga pra o app assumir o primeiro plano de verdade antes do Cmd+V.
        setTimeout(resolve, 120);
      },
    );
  });
}

/**
 * Cola o texto onde o cursor estiver, no app que está em primeiro plano.
 *
 * No macOS isso exige permissão de Acessibilidade. Sem ela, o texto fica só na
 * área de transferência e o usuário cola manualmente — o app continua útil.
 */
export function pasteAtCursor(text: string): Promise<PasteResult> {
  return new Promise((resolve) => {
    if (process.platform !== 'darwin') {
      clipboard.writeText(text);
      resolve('clipboard-only');
      return;
    }

    // prompt: true abre o painel do sistema na primeira vez que falta permissão.
    if (!systemPreferences.isTrustedAccessibilityClient(true)) {
      clipboard.writeText(text);
      resolve('clipboard-only');
      return;
    }

    const previous = clipboard.readText();
    clipboard.writeText(text);

    exec(
      `osascript -e 'tell application "System Events" to keystroke "v" using command down'`,
      (err) => {
        if (err) {
          resolve('clipboard-only');
          return;
        }
        // Devolve o que o usuário tinha copiado antes, depois que o Cmd+V
        // já foi processado pelo app de destino.
        setTimeout(() => {
          if (clipboard.readText() === text) clipboard.writeText(previous);
        }, 600);
        resolve('pasted');
      },
    );
  });
}
