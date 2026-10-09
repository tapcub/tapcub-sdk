import { preferences } from '@kit.ArkData';
import { fileIo as fs } from '@kit.CoreFileKit';
import type { common } from '@kit.AbilityKit';
import type { Storage } from '../core/types';
import { Brand } from './Brand';

export const DID_KEY = 'tc_did';
const ROTATED_KEY = 'tapcub_did_rotated';

/**
 * Small keys go to Preferences("tapcub_sdk"); queue chunks (`tc_q*`) are one file each under `filesDir/tapcub_queue`
 * (Preferences values were capped at 8 KB before API 12). Removing `tc_did` records a rotation so the next id
 * is generated instead of falling back to the ODID again (otherwise `reset()` would not rotate).
 */
export class DeviceStorage implements Storage {
  private readonly prefs: preferences.Preferences;
  private readonly dir: string;

  constructor(context: common.Context) {
    this.prefs = preferences.getPreferencesSync(context, { name: Brand.PREFS });
    this.dir = `${context.filesDir}/${Brand.QUEUE_DIR}`;
    if (!fs.accessSync(this.dir)) fs.mkdirSync(this.dir);
  }

  get(key: string): string | null {
    if (isQueueKey(key)) {
      const p = this.file(key);
      return fs.accessSync(p) ? fs.readTextSync(p) : null;
    }
    if (!this.prefs.hasSync(key)) return null;
    const v = this.prefs.getSync(key, '');
    return typeof v === 'string' ? v : null;
  }

  /** Throws when the write fails; the core reports `storage_failed` and keeps going. */
  set(key: string, value: string): void {
    if (isQueueKey(key)) {
      const p = this.file(key);
      const tmp = `${p}.tmp`;
      const f = fs.openSync(tmp, fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
      try {
        fs.writeSync(f.fd, value);
      } finally {
        fs.closeSync(f);
      }
      fs.renameSync(tmp, p);
      return;
    }
    this.prefs.putSync(key, value);
    void this.prefs.flush();
  }

  remove(key: string): void {
    if (isQueueKey(key)) {
      const p = this.file(key);
      if (fs.accessSync(p)) fs.unlinkSync(p);
      return;
    }
    this.prefs.deleteSync(key);
    if (key === DID_KEY) this.prefs.putSync(ROTATED_KEY, '1');
    void this.prefs.flush();
  }

  /** True once the core has dropped a device id on this install. */
  get didRotated(): boolean {
    return this.prefs.getSync(ROTATED_KEY, '') === '1';
  }

  private file(key: string): string {
    return `${this.dir}/${key.replace(/[^A-Za-z0-9_-]/g, '_')}`;
  }
}

function isQueueKey(key: string): boolean {
  return key.startsWith('tc_q');
}
