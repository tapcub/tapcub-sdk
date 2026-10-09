import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import type { Timers } from '../core/types';

/**
 * ArkTS runs SDK code on the UI thread's event loop, so plain JS timers are the right clock. Members are arrow
 * properties because the core passes `timers.random` / `timers.now` around unbound.
 */
export class ArkTimers implements Timers {
  private readonly rng: cryptoFramework.Random | null = createRng();

  now = (): number => Date.now();
  setTimeout = (fn: () => void, ms: number): unknown => setTimeout(fn, ms);
  clearTimeout = (id: unknown): void => clearTimeout(id as number);
  setInterval = (fn: () => void, ms: number): unknown => setInterval(fn, ms);
  clearInterval = (id: unknown): void => clearInterval(id as number);

  /** Device ids and session ids come from here, so prefer the system CSPRNG. */
  random = (): number => {
    if (this.rng) {
      try {
        const b = this.rng.generateRandomSync(4).data;
        return (((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0) / 4294967296;
      } catch {
        // fall through
      }
    }
    return Math.random();
  };
}

function createRng(): cryptoFramework.Random | null {
  try {
    return cryptoFramework.createRandom();
  } catch {
    return null;
  }
}
