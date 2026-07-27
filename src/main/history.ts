import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

/**
 * Histórico local de transcrições. Só texto — áudio nunca é gravado em disco.
 * O arquivo fica no userData do usuário e nunca sai da máquina; apagar aqui
 * apaga de verdade (não existe cópia no servidor).
 */
export interface HistoryEntry {
  id: string;
  text: string;
  createdAt: string; // ISO
  words: number;
  /** true = colado no cursor; false = ficou só na área de transferência */
  inserted: boolean;
}

const MAX_ENTRIES = 50;

export class HistoryStore {
  constructor(private file: string) {}

  private read(): HistoryEntry[] {
    try {
      const raw = fs.readFileSync(this.file, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
    } catch {
      return [];
    }
  }

  private write(entries: HistoryEntry[]): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(entries, null, 2), 'utf-8');
  }

  add(text: string, words: number, inserted: boolean): HistoryEntry {
    const entry: HistoryEntry = {
      id: randomUUID(),
      text,
      createdAt: new Date().toISOString(),
      words,
      inserted,
    };
    const entries = [entry, ...this.read()].slice(0, MAX_ENTRIES);
    this.write(entries);
    return entry;
  }

  list(): HistoryEntry[] {
    return this.read();
  }

  last(): HistoryEntry | null {
    return this.read()[0] ?? null;
  }

  find(id: string): HistoryEntry | null {
    return this.read().find((e) => e.id === id) ?? null;
  }

  remove(id: string): void {
    this.write(this.read().filter((e) => e.id !== id));
  }

  clear(): void {
    this.write([]);
  }
}
