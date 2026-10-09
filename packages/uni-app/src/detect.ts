// uni-app 编译时会把 process.env.UNI_PLATFORM 字面量替换掉，所以这里保留原写法，只给类型
declare const process: { env?: Record<string, string | undefined> } | undefined;

export type UniFlavor = 'mp' | 'app' | 'web';
export type UniDetect = { flavor: UniFlavor; platform: string; raw: string };

const MP: Record<string, string> = {
  'mp-weixin': 'mp_weixin',
  'mp-alipay': 'mp_alipay',
  'mp-toutiao': 'mp_bytedance',
  'mp-baidu': 'mp_weixin',
  mp_weixin: 'mp_weixin',
  mp_alipay: 'mp_alipay',
  mp_bytedance: 'mp_bytedance',
};

function fromRaw(raw: string): UniDetect {
  const s = String(raw || '').toLowerCase().trim();
  if (!s) return { flavor: 'app', platform: 'android', raw: s };
  if (s === 'h5' || s === 'web') return { flavor: 'web', platform: 'web', raw: s };
  if (MP[s]) return { flavor: 'mp', platform: MP[s], raw: s };
  if (s.startsWith('mp-') || s.startsWith('mp_')) return { flavor: 'mp', platform: MP[s] || 'mp_weixin', raw: s };
  if (s === 'app-ios' || s.includes('ios')) return { flavor: 'app', platform: 'ios', raw: s };
  if (s.startsWith('app')) return { flavor: 'app', platform: 'android', raw: s };
  return { flavor: 'app', platform: 'android', raw: s };
}

/** 优先参数 / 环境变量 / 全局 uni */
export function detectTarget(explicit?: string): UniDetect {
  if (explicit) return fromRaw(explicit);
  const env = (typeof process !== 'undefined' && process.env && (process.env.UNI_PLATFORM || process.env.UNI_UTS_PLATFORM)) || '';
  if (env) return fromRaw(env);
  try {
    const g = globalThis as { uni?: { getSystemInfoSync?: () => { uniPlatform?: string; osName?: string } } };
    const info = g.uni?.getSystemInfoSync?.();
    if (info?.uniPlatform) return fromRaw(info.uniPlatform);
    if (info?.osName === 'ios') return { flavor: 'app', platform: 'ios', raw: 'app-ios' };
  } catch {
    /* ignore */
  }
  return { flavor: 'app', platform: 'android', raw: '' };
}

export function assertNotH5(d: UniDetect): void {
  if (d.flavor === 'web') {
    throw new Error('uni-app H5: use the TapCub web script (w.js) instead of @tapcub/uni-app');
  }
}
