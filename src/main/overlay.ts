import { app, BrowserWindow, screen } from 'electron';
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
 */

const WIDTH = 296;
const HEIGHT = 104;
/** Altura quando mostra o "antes → depois", que precisa de duas linhas de texto. */
const HEIGHT_DIFF = 214;
/**
 * Posição vertical como fração da tela usável, medida do topo.
 *
 * A primeira versão ancorava no rodapé, perto do Dock — e um teste real
 * mostrou o problema: numa fala curta (poucos segundos), o painel aparece e
 * some numa área que a pessoa raramente olha enquanto digita. Ficou
 * praticamente invisível na prática, mesmo renderizando certinho (confirmado
 * por captura da própria janela). Perto do topo, abaixo da barra de menu, é
 * a mesma faixa onde o macOS mostra os próprios avisos (volume, Não
 * Perturbe) — o lugar que o olho já verifica por hábito.
 */
const TOP_FRACTION = 0.14;
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
let pendingDiff: { raw: string; final: string } | null = null;

function send(channel: string, payload: unknown): void {
  if (!win) return;
  if (!ready) {
    if (channel === 'overlay-state') pendingState = String(payload);
    return; // nível de áudio atrasado não interessa; estado, sim
  }
  win.webContents.send(channel, payload);
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
    webPreferences: {
      preload: path.join(__dirname, '../renderer/overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 'screen-saver' é o nível mais alto do macOS — precisa dele pra cobrir
  // app em tela cheia (ver item 3 do cabeçalho). Não exige nada de especial;
  // quem impedia a janela de aparecer era a falta de ativação do processo
  // (ver o app.focus() em syncOverlay(), que é a causa raiz de verdade).
  w.setAlwaysOnTop(true, 'screen-saver');
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  w.setIgnoreMouseEvents(true); // ver (2)

  w.webContents.once('did-finish-load', () => {
    ready = true;
    if (pendingState) {
      w.webContents.send('overlay-state', pendingState);
      pendingState = null;
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
  if (!win) win = create();
}

/** Centraliza no topo, no monitor onde o cursor está — não no monitor principal. */
function reposition(w: BrowserWindow, height = HEIGHT): void {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width, height: areaHeight } = display.workArea;
  w.setBounds({
    x: Math.round(x + (width - WIDTH) / 2),
    y: Math.round(y + areaHeight * TOP_FRACTION),
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
    if (!win) return;
    if (hideTimer) clearTimeout(hideTimer);

    if (pendingDiff) {
      // Cresce e mostra o antes → depois. Fica mais tempo porque agora há o
      // que ler; sem isso, piscaria antes de qualquer um enxergar.
      reposition(win, HEIGHT_DIFF);
      send('overlay-diff', pendingDiff);
      pendingDiff = null;
      hideTimer = setTimeout(() => win?.hide(), DIFF_MS);
      return;
    }

    send('overlay-state', 'done');
    hideTimer = setTimeout(() => win?.hide(), 500);
    return;
  }

  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (!win) win = create();
  if (!win.isVisible()) {
    // Sem isto, o painel simplesmente não aparece na tela real — mesmo
    // relatando `isVisible()=true` e bounds corretos. Comprovado por captura
    // real da tela (não capturePage(), que só prova que o Chromium desenhou,
    // não que o WindowServer compôs): um app menu-bar-only (sem janela
    // regular própria) perde a ativação assim que outro app fica em primeiro
    // plano por um tempo — testado e confirmado: funcionava logo após abrir,
    // falhava de novo minutos depois, com o usuário trabalhando em outro app.
    // Por isso a chamada mora AQUI, a cada exibição, e não só na subida do
    // app. app.focus({steal:true}) força a ativação sem abrir nada visível —
    // diferente de app.dock.show(), não muda a política do Dock.
    app.focus({ steal: true });
    reposition(win); // a cada ditado: a pessoa pode ter trocado de monitor
    win.showInactive(); // ver (1): mostrar SEM tomar o foco
  }
  send('overlay-state', state);
}

/** Volume do microfone (0…1) — é o que prova que ele está captando a pessoa. */
export function setOverlayLevel(level: number): void {
  if (win?.isVisible()) send('overlay-level', level);
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
  win?.destroy();
  win = null;
  ready = false;
  pendingState = null;
}
