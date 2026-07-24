import { clipboard, systemPreferences } from 'electron';
import { exec } from 'child_process';

export type PasteResult = 'pasted' | 'clipboard-only';

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
