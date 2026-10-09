/**
 * 一致性向量用的 mock 适配（dev_behavior_phase3/01 §11）：虚拟时钟、脚本化网络、可驱动的生命周期、固定设备信息、确定性随机。
 * 同一份 mock 语义在其它端（Swift / Kotlin / ArkTS）各实现一次；向量文件是唯一事实来源。
 */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createMock(vector) {
  const start = vector.now ?? 1_700_000_000_000;
  let now = start;
  let seq = 0;
  const timers = new Map();
  const random = mulberry32(vector.seed ?? 42);
  const clock = {
    now: () => now,
    setTimeout(fn, ms) {
      const id = ++seq;
      timers.set(id, { at: now + Math.max(0, ms), fn, every: 0 });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    setInterval(fn, ms) {
      const id = ++seq;
      timers.set(id, { at: now + Math.max(1, ms), fn, every: Math.max(1, ms) });
      return id;
    },
    clearInterval(id) {
      timers.delete(id);
    },
    clearAll() {
      timers.clear();
    },
    random,
    /** 推进虚拟时间，按到期顺序触发定时器 */
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        let next = null;
        for (const [id, t] of timers) if (t.at <= target && (!next || t.at < next.t.at)) next = { id, t };
        if (!next) break;
        now = Math.max(now, next.t.at);
        if (next.t.every) next.t.at += next.t.every;
        else timers.delete(next.id);
        try {
          next.t.fn();
        } catch {
          /* SDK 内部已 guard */
        }
        await drain();
      }
      now = target;
      await drain();
    },
  };

  const store = new Map(Object.entries(vector.storage ?? {}));
  const storage = {
    get: (k) => (store.has(k) ? store.get(k) : null),
    set: (k, v) => {
      if (net.storageFail) throw new Error('storage quota');
      store.set(k, String(v));
    },
    remove: (k) => {
      store.delete(k);
    },
    dump: () => Object.fromEntries(store),
  };

  const net = {
    /** cfg 响应：object → 200 JSON；'fail' → 网络错误；number → 该状态码 */
    cfg: vector.cfg === undefined ? { t: 3, i: 1, cs: { req: false } } : vector.cfg,
    /** collect 响应：number 状态码或 'fail'；数组按次消费，耗尽用最后一个 */
    collect: vector.collect ?? 202,
    collectSeq: Array.isArray(vector.collect) ? [...vector.collect] : null,
    storageFail: false,
    requests: [],
    cfgRequests: [],
  };
  const respond = (script) => {
    if (script === 'fail') return Promise.reject(new Error('network'));
    if (typeof script === 'number') return Promise.resolve({ status: script, body: '' });
    return Promise.resolve({ status: 200, body: JSON.stringify(script) });
  };
  const transport = {
    get(url) {
      net.cfgRequests.push({ url, at: now });
      return respond(net.cfg);
    },
    post(url, body, headers) {
      let parsed = null;
      try {
        parsed = JSON.parse(body);
      } catch {
        /* ignore */
      }
      net.requests.push({ url, body: parsed, headers, at: now, bytes: Buffer.byteLength(body) });
      let script = net.collect;
      if (net.collectSeq) script = net.collectSeq.length > 1 ? net.collectSeq.shift() : net.collectSeq[0];
      return respond(script);
    },
  };

  let handlers = null;
  const lifecycle = {
    bind(h) {
      handlers = h;
    },
    currentPage: () => null,
    fire(kind, arg, arg2) {
      if (!handlers) throw new Error('lifecycle not bound (preInit not called)');
      const map = { launch: 'onLaunch', show: 'onShow', hide: 'onHide', pageShow: 'onPageShow', pageHide: 'onPageHide', share: 'onShare', favorite: 'onFavorite' };
      handlers[map[kind]](arg, arg2);
    },
  };

  const deviceReads = { count: 0, networkReads: 0 };
  const device = {
    platform: vector.platform ?? 'android',
    read() {
      deviceReads.count++;
      return { os: 'Android', osVersion: '14', brand: 'Google', model: 'Pixel 8', deviceType: 'phone', screenWidth: 1080, screenHeight: 2400, pixelRatio: 2.75, locale: 'zh-CN', timezone: 'Asia/Shanghai', hostVersion: '14', ...(vector.device ?? {}) };
    },
    networkType() {
      deviceReads.networkReads++;
      return Promise.resolve('wifi');
    },
  };
  if (vector.nativeDeviceId !== undefined) device.deviceId = () => vector.nativeDeviceId;

  const auto = { cb: null };
  const autoTrack = {
    enable: (cb) => (auto.cb = cb),
    disable: () => (auto.cb = null),
    tap(el, page) {
      if (auto.cb) auto.cb(el, page ?? null);
    },
  };

  const logs = [];
  const crash = { cb: null };
  const crashHook = {
    enable: (cb) => (crash.cb = cb),
    disable: () => (crash.cb = null),
    fire(ev) {
      if (crash.cb) crash.cb(ev);
    },
  };

  const adapters = { storage, transport, lifecycle, device, timers: clock, autoTrack, crash: crashHook, log: (level, msg) => logs.push(`${level}: ${msg}`) };
  return { adapters, clock, storage, net, lifecycle, deviceReads, logs, start, autoTrack, crash: crashHook };
}

/** 让 Promise 链跑完（transport / init 的 then 链） */
export async function drain(rounds = 8) {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}
