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
    // Timeout curto: esta leitura acontece com a gravação JÁ em curso, e nada
    // pode segurar o ditado. Se o osascript travar, seguimos sem o destino —
    // o texto ainda vai para a área de transferência, que é a degradação certa.
    let done = false;
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    setTimeout(() => finish(null), 1_500);
    exec(
      `osascript -e 'tell application "System Events" to name of first application process whose frontmost is true'`,
      (err, stdout) => finish(err ? null : stdout.trim() || null),
    );
  });
}

/**
 * Desfaz a última inserção apagando exatamente o que a VozzAI colou.
 *
 * Colar no campo errado — ou sobre um texto que já tinha conteúdo — é um
 * acidente comum, e até aqui a pessoa precisava apagar na mão.
 *
 * Por que backspace e não Cmd+Z: o histórico de desfazer pertence ao app de
 * destino. Depois de um paste programático, o Cmd+Z de muitos apps desfaz
 * mais do que a VozzAI escreveu (ou não desfaz nada). Apagar a contagem exata
 * de caracteres é previsível: sai o que entrou, nada além.
 *
 * O `repeat` roda DENTRO do AppleScript de propósito — um osascript por
 * caractere levaria minutos num ditado de 400 palavras.
 */
export function undoInsertion(charCount: number, targetApp: string | null): Promise<boolean> {
  return new Promise((resolve) => {
    if (process.platform !== 'darwin' || charCount <= 0) return resolve(false);
    // prompt: false — se a permissão não existe, não é hora de pedir.
    if (!systemPreferences.isTrustedAccessibilityClient(false)) return resolve(false);

    const steps = Math.min(charCount, 5_000); // teto de sanidade
    const activate = targetApp
      ? `tell application "System Events" to set frontmost of (first process whose name is "${targetApp.replace(/"/g, '\\"')}") to true\ndelay 0.12\n`
      : '';
    const script =
      `${activate}tell application "System Events" to repeat ${steps} times\nkey code 51\nend repeat`;

    exec(`osascript -e ${JSON.stringify(script)}`, (err) => resolve(!err));
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

    // Só dá pra restaurar o que é texto. Se a pessoa tinha uma IMAGEM ou um
    // arquivo copiado, `readText()` devolve '' — e restaurar isso apagaria o
    // que ela tinha. Nesse caso é melhor não mexer: ela fica com o texto
    // ditado na área de transferência, que é uma troca honesta, em vez de
    // perder o print que ia colar depois sem nem perceber.
    const previousText = clipboard.readText();
    const canRestore = previousText !== '' || clipboard.availableFormats().length === 0;

    clipboard.writeText(text);

    exec(
      `osascript -e 'tell application "System Events" to keystroke "v" using command down'`,
      (err) => {
        if (err) {
          resolve('clipboard-only');
          return;
        }
        if (canRestore) {
          // Devolve o que o usuário tinha copiado antes, depois que o Cmd+V
          // já foi processado pelo app de destino.
          setTimeout(() => {
            if (clipboard.readText() === text) clipboard.writeText(previousText);
          }, 600);
        }
        resolve('pasted');
      },
    );
  });
}
