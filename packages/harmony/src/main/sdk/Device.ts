import { deviceInfo } from '@kit.BasicServicesKit';
import { display } from '@kit.ArkUI';
import { i18n } from '@kit.LocalizationKit';
import { connection } from '@kit.NetworkKit';
import type { DeviceInfo, DeviceSnapshot } from '../core/types';
import { DID_KEY, type DeviceStorage } from './Storage';

const ODID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export class SystemDevice implements DeviceInfo {
  readonly platform = 'harmony' as const;

  constructor(private readonly storage: DeviceStorage) {}

  read(): DeviceSnapshot {
    const snap: DeviceSnapshot = {
      os: deviceInfo.distributionOSName || 'HarmonyOS',
      osVersion: deviceInfo.distributionOSVersion || deviceInfo.osFullName,
      brand: deviceInfo.brand,
      model: deviceInfo.productModel,
      deviceType: deviceType(deviceInfo.deviceType),
      locale: languageTag(safe(() => i18n.System.getSystemLocale(), '')),
      timezone: safe(() => i18n.getTimeZone().getID(), ''),
    };
    try {
      const d = display.getDefaultDisplaySync();
      snap.screenWidth = Math.min(d.width, d.height);
      snap.screenHeight = Math.max(d.width, d.height);
      snap.pixelRatio = d.densityPixels;
    } catch {
      // headless or display service unavailable
    }
    return snap;
  }

  /** Needs `ohos.permission.GET_NETWORK_INFO`; without it this reports `unknown`. */
  async networkType(): Promise<string> {
    try {
      const net = await connection.getDefaultNet();
      if (!net || net.netId === 0) return 'none';
      const caps = await connection.getNetCapabilities(net);
      const types = caps.bearerTypes || [];
      if (types.includes(connection.NetBearType.BEARER_WIFI)) return 'wifi';
      if (types.includes(connection.NetBearType.BEARER_CELLULAR)) return 'cellular';
      if (types.includes(connection.NetBearType.BEARER_ETHERNET)) return 'ethernet';
      return 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /** ODID (same for all apps of one developer on a device, reset on factory reset). Read only after consent. */
  deviceId(): string | null {
    const stored = this.storage.get(DID_KEY);
    if (stored) return stored;
    if (this.storage.didRotated) return null;
    const odid = safe(() => deviceInfo.ODID, '');
    if (!odid || !ODID_RE.test(odid) || /^[0-]+$/.test(odid)) return null;
    return `harmony_odid:${odid}`;
  }
}

function deviceType(t: string): DeviceSnapshot['deviceType'] {
  switch (t) {
    case 'phone':
    case 'default':
      return 'phone';
    case 'tablet':
      return 'tablet';
    case 'tv':
      return 'tv';
    default:
      return 'other';
  }
}

/** `zh-Hans-CN` → `zh-CN`; script-only Chinese maps to CN / TW like the other platforms. */
export function languageTag(raw: string): string {
  const parts = raw.replace(/_/g, '-').split('-').filter(Boolean);
  const lang = (parts[0] || '').toLowerCase();
  if (!lang) return 'und';
  const region = parts.slice(1).find((p) => /^[A-Za-z]{2}$|^\d{3}$/.test(p));
  if (region) return `${lang}-${region.toUpperCase()}`;
  const script = parts.slice(1).find((p) => /^[A-Za-z]{4}$/.test(p));
  if (lang === 'zh' && script) return script.toLowerCase() === 'hant' ? 'zh-TW' : 'zh-CN';
  return lang;
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn() ?? fallback;
  } catch {
    return fallback;
  }
}
