import { BrowserWindow, screen } from 'electron';
import * as path from 'path';
import { DictationState } from './state';

/**
 * Painel flutuante que aparece sobre qualquer app enquanto o ditado acontece.
 *
 * Existe porque o único retorno visual até aqui era o emoji da bandeja mudar de
 * 🎙️ para 🔴 — no canto oposto de onde a pessoa está olhando, que é o campo de
 * texto. Usuários relataram exatamente isso: não dá pra saber se está
 * acontecendo. É uma hipótese forte pro gargalo de ativação (a maioria cadastra
 * e nunca dita): quem aperta o atalho, não vê nada e conclui que quebrou.
 *
 * Três exigências inegociáveis, porque o painel aparece por cima do trabalho
 * alheio e some sozinho:
 *
 * 1. `focusable: false` + `showInactive()` — se roubar o foco, o Cmd+V do
 *    fim do fluxo cola no lugar errado e o ditado se perde. É o bug mais caro
 *    possível aqui, então o painel nunca é focável.
 * 2. `setIgnoreMouseEvents(true)` — clique atravessa. O painel fica sobre a
 *    tela inteira; se capturasse clique, viraria um obstáculo.
 * 3. Nível 'screen-saver' + `visibleOnFullScreen` — ditado em app de tela
 *    cheia (Keynote, vídeo, Xcode) é caso comum; sem isso o painel some
 *    justamente quando a pessoa mais precisa da confirmação.
 * 4. `type: 'panel'` no macOS — vira um NSPanel "não ativador"
 *    (NSWindowStyleMaskNonactivatingPanel), que é a peça que permite
 *    aparecer sobre os outros apps SEM trazer o VozzAI para primeiro plano.
 *    Antes disso o código chamava `app.focus({steal:true})` a cada ditado,
 *    e era isso que tirava a pessoa do app onde ela estava escrevendo —
 *    como o VozzAI não tem janela regular, o que aparecia era a área de
 *    trabalho. Medido: com `type:'panel'` e sem `app.focus`, o painel
 *    aparece na captura real de tela (screencapture, não capturePage) —
 *    ou seja, a ativação nunca foi necessária para ele ser composto.
 */

/**
 * 330 e não 296: com o modo de escrita na primeira linha, os nomes mais longos
 * do catálogo ("E-mail profissional", "Transcrição fiel") espremiam o rótulo a
 * ponto de sobrar "Ouvind…". Medido com captura real nos dois extremos —
 * "WhatsApp" e "E-mail profissional" — 330 acomoda rótulo, modo e cronômetro
 * inteiros, e o painel continua discreto.
 */
const WIDTH = 330;
const HEIGHT = 104;
/** Altura quando mostra o "antes → depois", que precisa de duas linhas de texto. */
const HEIGHT_DIFF = 214;
/**
 * O painel fica centralizado na tela, na horizontal e na vertical.
 *
 * Histórico: a primeira versão ancorava no rodapé, perto do Dock, e sumia da
 * atenção; a segunda subiu para perto do topo (14% da altura), na faixa onde
 * o macOS mostra os próprios avisos. Nenhuma das duas resolveu — o retorno do
 * uso real foi que o painel precisa estar no centro, onde o olho já está
 * enquanto a pessoa escreve, e não numa borda.
 */
/** Quanto o antes → depois fica na tela. Tempo de ler sem virar estorvo. */
const DIFF_MS = 5_200;

let win: BrowserWindow | null = null;
let hideTimer: NodeJS.Timeout | null = null;
/**
 * `loadFile` é assíncrono. Sem esta trava, o primeiro ditado mandava
 * 'overlay-state' antes de a página existir pra ouvir — a mensagem se perdia,
 * o painel ficava em `opacity: 0` e o usuário via exatamente nada. Foi o que
 * aconteceu no primeiro teste real.
 */
let ready = false;
let pendingState: string | null = null;
let pendingMode: string | null = null;
let pendingDiff: { raw: string; final: string } | null = null;

/**
 * A janela — ou null se ela não existe MAIS.
 *
 * `win?.metodo()` protege só de null, e um BrowserWindow destruído continua
 * sendo um objeto: qualquer método dele lança "Object has been destroyed".
 * Isso derrubou o app com diálogo de erro no rosto do usuário. O caminho: ao
 * sair, o Electron destrói as janelas ANTES do 'will-quit', que é onde
 * destroyOverlay() zera esta variável — e o medidor de volume, que dispara
 * várias vezes por segundo enquanto grava, chega nesse intervalo.
 *
 * Toda leitura de `win` passa por aqui justamente porque a versão anterior
 * tinha a checagem certa (`if (!win)`) em todo lugar e ainda assim quebrava:
 * o problema nunca foi esquecer de checar, foi checar a coisa errada.
 */
function alive(): BrowserWindow | null {
  if (win && win.isDestroyed()) win = null;
  return win;
}

function send(channel: string, payload: unknown): void {
  const w = alive();
  if (!w) return;
  if (!ready) {
    // Estado e modo são os dois que não podem se perder: o painel abriria
    // sem dizer o que está acontecendo nem com que modo vai escrever.
    if (channel === 'overlay-state') pendingState = String(payload);
    if (channel === 'overlay-mode') pendingMode = String(payload);
    return; // nível de áudio atrasado não interessa; estado, sim
  }
  // O webContents pode morrer antes da janela em desligamento.
  if (w.webContents.isDestroyed()) return;
  w.webContents.send(channel, payload);
}

function create(): BrowserWindow {
  const w = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false, // ver (1) no cabeçalho
    alwaysOnTop: true,
    // ver (4): só existe no macOS; em outra plataforma o valor é ignorado,
    // mas mandar só onde vale deixa a intenção explícita.
    ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../renderer/overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 'screen-saver' é o nível mais alto do macOS — precisa dele pra cobrir
  // app em tela cheia (ver item 3 do cabeçalho). Junto com o type:'panel'
  // do construtor, é o que basta para o painel ser composto por cima de
  // tudo sem que o VozzAI precise virar o app ativo.
  w.setAlwaysOnTop(true, 'screen-saver');
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  w.setIgnoreMouseEvents(true); // ver (2)

  w.webContents.once('did-finish-load', () => {
    // A janela pode ter morrido entre o loadFile e o fim do carregamento —
    // fechar o app logo depois de abrir é suficiente para cair aqui.
    if (w.isDestroyed() || w.webContents.isDestroyed()) return;
    ready = true;
    if (pendingState) {
      w.webContents.send('overlay-state', pendingState);
      pendingState = null;
    }
    if (pendingMode) {
      w.webContents.send('overlay-mode', pendingMode);
      pendingMode = null;
    }
  });

  w.loadFile(path.join(__dirname, '../renderer/overlay.html'));
  return w;
}

/**
 * Cria o painel já na subida do app, escondido. Assim o primeiro ditado não
 * paga o tempo de carregar a página — e o primeiro ditado é justamente o que
 * decide se a pessoa continua usando ou desiste.
 */
export function initOverlay(): void {
  if (!alive()) win = create();
}

/** Centraliza na tela, no monitor onde o cursor está — não no monitor principal. */
function reposition(w: BrowserWindow, height = HEIGHT): void {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width, height: areaHeight } = display.workArea;
  w.setBounds({
    x: Math.round(x + (width - WIDTH) / 2),
    // Desconta a própria altura para o centro do painel bater com o centro da
    // tela — inclusive quando ele cresce para mostrar o antes → depois.
    y: Math.round(y + (areaHeight - height) / 2),
    width: WIDTH,
    height,
  });
}

/**
 * Reflete o estado do ditado. `idle` esconde — com um respiro de meio segundo,
 * para o "Pronto!" ser visto antes de sumir, em vez de piscar.
 */
export function syncOverlay(state: DictationState): void {
  if (state === 'idle') {
    const w = alive();
    if (!w) return;
    if (hideTimer) clearTimeout(hideTimer);

    if (pendingDiff) {
      // Cresce e mostra o antes → depois. Fica mais tempo porque agora há o
      // que ler; sem isso, piscaria antes de qualquer um enxergar.
      reposition(w, HEIGHT_DIFF);
      send('overlay-diff', pendingDiff);
      pendingDiff = null;
      // O timer dispara segundos depois: a janela pode não existir mais lá.
      hideTimer = setTimeout(() => alive()?.hide(), DIFF_MS);
      return;
    }

    send('overlay-state', 'done');
    hideTimer = setTimeout(() => alive()?.hide(), 500);
    return;
  }

  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (!alive()) win = create();
  const w = win as BrowserWindow;
  if (!w.isVisible()) {
    // NÃO ativar o app aqui. A versão anterior chamava app.focus({steal:true})
    // neste ponto por acreditar que sem isso o painel não seria composto pelo
    // WindowServer. Era o que tirava a pessoa do app onde ela estava
    // escrevendo — e, como o VozzAI não tem janela regular, o que aparecia no
    // lugar era a área de trabalho. Com type:'panel' (ver item 4 do
    // cabeçalho) a exibição não depende de ativação nenhuma.
    reposition(w); // a cada ditado: a pessoa pode ter trocado de monitor
    w.showInactive(); // ver (1): mostrar SEM tomar o foco
  }
  send('overlay-state', state);
}

/**
 * Nome do modo de escrita em vigor, exibido no painel.
 *
 * O modo decide o que acontece com o que a pessoa falou — WhatsApp encurta,
 * Jurídico formaliza, Transcrição fiel não mexe em nada. Até aqui ele só
 * aparecia num submenu da bandeja, então dava para ditar a semana inteira no
 * modo errado sem perceber. Mostrar no painel é o único momento em que a
 * pessoa está olhando e ainda dá tempo de cancelar com esc.
 */
export function setOverlayMode(name: string): void {
  if (!alive()) win = create();
  send('overlay-mode', name);
}

/**
 * Volume do microfone (0…1) — é o que prova que ele está captando a pessoa.
 *
 * Dispara muitas vezes por segundo durante a gravação, o que fez desta a
 * função mais exposta do módulo: era exatamente aqui que o app quebrava ao
 * ser fechado no meio de um ditado (ver alive()).
 */
export function setOverlayLevel(level: number): void {
  const w = alive();
  if (w && w.isVisible()) send('overlay-level', level);
}

/**
 * Guarda o "antes → depois" para ser exibido quando o ditado terminar.
 *
 * Fica pendente em vez de aparecer na hora porque quem encerra o painel é a
 * volta da máquina para `idle`, logo depois — mostrar aqui seria sobrescrito
 * meio segundo depois pelo "Pronto".
 *
 * `raw` nulo (limpeza não mudou nada) não vira diff: painel que anuncia
 * "olha o que eu fiz" sem ter feito nada gasta a atenção da pessoa à toa.
 */
export function showOverlayDiff(raw: string | null, final: string): void {
  if (!raw || !final) return;
  pendingDiff = { raw, final };
}

export function destroyOverlay(): void {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = null;
  // alive() em vez de win?.destroy(): no 'will-quit' o Electron normalmente já
  // destruiu a janela, e destruir de novo lançaria dentro do próprio
  // desligamento — que é o pior lugar para uma exceção aparecer.
  alive()?.destroy();
  win = null;
  ready = false;
  pendingState = null;
  pendingMode = null;
  pendingDiff = null;
}
