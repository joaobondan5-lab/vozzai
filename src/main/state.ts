/**
 * Máquina de estados do ditado. O objetivo é um só: o usuário nunca ficar em
 * dúvida se o app está ouvindo, processando ou livre — e o código nunca
 * aceitar uma transição impossível (ex.: começar a gravar no meio de um
 * processamento) que antes era só um booleano torcendo para dar certo.
 */
export type DictationState = 'idle' | 'recording' | 'processing' | 'inserting';

const ALLOWED: Record<DictationState, DictationState[]> = {
  idle: ['recording', 'processing'], // processing direto = "tentar de novo" com áudio guardado
  recording: ['processing', 'idle'], // idle = cancelado (Esc)
  processing: ['inserting', 'idle'], // idle = erro na transcrição
  inserting: ['idle'],
};

type Listener = (state: DictationState, previous: DictationState) => void;

export class DictationMachine {
  private state: DictationState = 'idle';
  private listeners: Listener[] = [];

  get current(): DictationState {
    return this.state;
  }

  onChange(listener: Listener): void {
    this.listeners.push(listener);
  }

  /** Tenta a transição; devolve false (sem mudar nada) se ela não é permitida. */
  to(next: DictationState): boolean {
    if (!ALLOWED[this.state].includes(next)) return false;
    const previous = this.state;
    this.state = next;
    this.listeners.forEach((l) => l(next, previous));
    return true;
  }

  /** Volta ao repouso de qualquer estado — é a saída de todo fluxo, feliz ou não. */
  reset(): void {
    if (this.state === 'idle') return;
    const previous = this.state;
    this.state = 'idle';
    this.listeners.forEach((l) => l('idle', previous));
  }
}
