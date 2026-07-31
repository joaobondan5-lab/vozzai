import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

/**
 * Guarda de regressão do painel flutuante.
 *
 * Por que um teste que lê o código-fonte em vez de exercitar o módulo: overlay.ts
 * importa `electron`, que não existe fora do runtime do Electron — dentro do
 * vitest o import quebra. O que precisa ser protegido aqui é uma decisão de
 * implementação ("nunca ative o app para mostrar o painel"), e ela é verificável
 * lendo o arquivo, do mesmo jeito que uma regra de lint faria.
 *
 * O bug que isto impede de voltar: syncOverlay() chamava
 * `app.focus({ steal: true })` a cada exibição, acreditando que sem isso o
 * painel não seria composto pelo WindowServer — havia até um comentário longo
 * justificando a chamada. O efeito real era tirar a pessoa do app onde ela
 * estava escrevendo: como o VozzAI não tem janela regular própria, ativá-lo
 * mostrava a área de trabalho. Quem ditava perdia a tela no meio da frase.
 *
 * A premissa era falsa: medido com captura real de tela, o painel aparece
 * normalmente com `type: 'panel'` (NSPanel não-ativador) e sem ativação alguma.
 *
 * Este teste existe porque a armadilha é convidativa — o sintoma de "painel não
 * aparece" leva direto de volta ao app.focus(). Se você chegou aqui por causa
 * de uma falha, a resposta quase certamente NÃO é reativar o app: confira
 * primeiro se o type:'panel' e o nível 'screen-saver' continuam no lugar.
 */
describe('painel flutuante (overlay)', () => {
  const source = readFileSync(path.join(__dirname, '../src/main/overlay.ts'), 'utf8');

  /** Só o código, sem comentários — para as asserções não baterem no texto explicativo. */
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');

  it('nunca ativa o app para mostrar o painel', () => {
    expect(code).not.toContain('app.focus');
    expect(code).not.toContain('steal');
    // dock.show() muda a política de ativação e teria o mesmo efeito colateral
    expect(code).not.toContain('dock.show');
  });

  it('usa NSPanel não-ativador no macOS, que é o que substitui a ativação', () => {
    expect(code).toContain("type: 'panel'");
    expect(code).toContain("process.platform === 'darwin'");
  });

  it('mostra sem tomar o foco e continua ignorando clique', () => {
    expect(code).toContain('showInactive()');
    expect(code).not.toContain('win.show()');
    expect(code).toContain('setIgnoreMouseEvents(true)');
    expect(code).toContain('focusable: false');
  });

  it('fica acima de app em tela cheia', () => {
    expect(code).toContain("'screen-saver'");
    expect(code).toContain('visibleOnFullScreen: true');
  });

  // `loadFile` é assíncrono: no primeiro ditado a mensagem chega antes de a
  // página existir para ouvir. O estado já tinha sido perdido assim uma vez
  // (o painel abria em branco); o modo entra na mesma fila pelo mesmo motivo.
  it('guarda o modo para reenviar quando a página terminar de carregar', () => {
    expect(code).toContain('pendingMode');
    expect(code).toContain("channel === 'overlay-mode'");
    // e precisa mesmo ser reenviado no did-finish-load, não só guardado
    expect(code).toMatch(/did-finish-load[\s\S]*pendingMode = null/);
  });

  // Crash real, com diálogo de erro na cara do usuário:
  // "TypeError: Object has been destroyed at setOverlayLevel".
  // `win?.metodo()` protege só de null; um BrowserWindow destruído continua
  // sendo objeto e lança em qualquer método. Ao sair, o Electron destrói as
  // janelas antes do 'will-quit' (onde a variável é zerada), e o medidor de
  // volume — várias chamadas por segundo — cai nesse intervalo.
  it('trata janela destruída como ausente, não confia em `win?.`', () => {
    expect(code).toContain('isDestroyed()');
    // nenhum acesso solto: tudo passa pelo acessor que checa destruição
    expect(code).not.toMatch(/win\?\./);
    expect(code).not.toMatch(/\bif \(!win\)/);
  });

  it('centraliza na tela descontando a própria altura', () => {
    // Sem descontar a altura, o painel "desce" quando cresce para mostrar o
    // antes → depois, e deixa de ficar centrado justamente na hora em que
    // ocupa mais espaço.
    expect(code).toContain('(areaHeight - height) / 2');
  });
});
