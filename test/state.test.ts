import { describe, expect, it } from 'vitest';
import { DictationMachine } from '../src/main/state';

describe('DictationMachine', () => {
  it('segue o caminho feliz idle → recording → processing → inserting → idle', () => {
    const m = new DictationMachine();
    expect(m.current).toBe('idle');
    expect(m.to('recording')).toBe(true);
    expect(m.to('processing')).toBe(true);
    expect(m.to('inserting')).toBe(true);
    m.reset();
    expect(m.current).toBe('idle');
  });

  it('rejeita transições impossíveis sem mudar o estado', () => {
    const m = new DictationMachine();
    expect(m.to('inserting')).toBe(false); // não dá pra inserir sem transcrever
    expect(m.current).toBe('idle');

    m.to('recording');
    expect(m.to('recording')).toBe(false); // já está gravando
    expect(m.to('inserting')).toBe(false); // pular o processamento é proibido
    expect(m.current).toBe('recording');
  });

  it('permite cancelar a gravação (recording → idle)', () => {
    const m = new DictationMachine();
    m.to('recording');
    expect(m.to('idle')).toBe(true);
  });

  it('permite retry direto de idle → processing (áudio guardado)', () => {
    const m = new DictationMachine();
    expect(m.to('processing')).toBe(true);
  });

  it('permite abortar por erro (processing → idle)', () => {
    const m = new DictationMachine();
    m.to('recording');
    m.to('processing');
    expect(m.to('idle')).toBe(true);
  });

  it('notifica os ouvintes com estado novo e anterior', () => {
    const m = new DictationMachine();
    const seen: string[] = [];
    m.onChange((next, prev) => seen.push(`${prev}→${next}`));
    m.to('recording');
    m.to('processing');
    m.reset();
    expect(seen).toEqual(['idle→recording', 'recording→processing', 'processing→idle']);
  });

  it('reset em idle não dispara ouvinte (nada mudou)', () => {
    const m = new DictationMachine();
    let calls = 0;
    m.onChange(() => calls++);
    m.reset();
    expect(calls).toBe(0);
  });
});
