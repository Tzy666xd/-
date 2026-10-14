// 两份本机存档：主档坏了回到最近一份有效备份；写入失败不覆盖旧进度。
import { SAVE_KEY, summarize } from '../core/save.ts';

export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function createSaveStore(storage: () => StoragePort, key = SAVE_KEY) {
  const backupKey = `${key}.backup`;
  return {
    recovered: false,
    get(): string | null {
      this.recovered = false;
      try {
        const port = storage();
        const current = port.getItem(key);
        if (current && summarize(current)) return current;
        const backup = port.getItem(backupKey);
        if (backup && summarize(backup)) {
          this.recovered = true;
          return backup;
        }
        return null;
      } catch { return null; }
    },
    set(text: string): boolean {
      if (!summarize(text)) return false;
      try {
        const port = storage();
        const current = port.getItem(key);
        if (current && summarize(current)) port.setItem(backupKey, current);
        port.setItem(key, text);
        return true;
      } catch { return false; }
    },
    del(): boolean {
      try {
        const port = storage();
        port.removeItem(backupKey);
        port.removeItem(key);
        return true;
      } catch { return false; }
    },
  };
}
