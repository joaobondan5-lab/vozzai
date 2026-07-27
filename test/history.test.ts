import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HistoryStore } from '../src/main/history';

let dir: string;
let store: HistoryStore;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vozza-history-'));
  store = new HistoryStore(path.join(dir, 'history.json'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('HistoryStore', () => {
  it('começa vazio e sem last()', () => {
    expect(store.list()).toEqual([]);
    expect(store.last()).toBeNull();
  });

  it('guarda entradas com o mais recente primeiro', () => {
    store.add('primeiro texto', 2, true);
    store.add('segundo texto', 2, false);
    const entries = store.list();
    expect(entries).toHaveLength(2);
    expect(entries[0].text).toBe('segundo texto');
    expect(entries[0].inserted).toBe(false);
    expect(store.last()?.text).toBe('segundo texto');
  });

  it('encontra, remove e limpa por id', () => {
    const a = store.add('fica', 1, true);
    const b = store.add('sai', 1, true);
    expect(store.find(b.id)?.text).toBe('sai');

    store.remove(b.id);
    expect(store.find(b.id)).toBeNull();
    expect(store.list()).toHaveLength(1);
    expect(store.find(a.id)?.text).toBe('fica');

    store.clear();
    expect(store.list()).toEqual([]);
  });

  it('corta em 50 entradas para o arquivo não crescer para sempre', () => {
    for (let i = 0; i < 55; i++) store.add(`texto ${i}`, 2, true);
    const entries = store.list();
    expect(entries).toHaveLength(50);
    expect(entries[0].text).toBe('texto 54'); // mais novo sobrevive
    expect(entries[49].text).toBe('texto 5'); // mais velhos caem
  });

  it('sobrevive a arquivo corrompido sem lançar', () => {
    fs.writeFileSync(path.join(dir, 'history.json'), '{nem-json');
    expect(store.list()).toEqual([]);
    store.add('depois do caos', 3, true);
    expect(store.list()).toHaveLength(1);
  });

  it('persiste entre instâncias (mesmo arquivo)', () => {
    store.add('persistido', 1, true);
    const second = new HistoryStore(path.join(dir, 'history.json'));
    expect(second.last()?.text).toBe('persistido');
  });
});
