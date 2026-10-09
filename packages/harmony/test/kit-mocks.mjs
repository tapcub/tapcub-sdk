/**
 * In-memory stand-ins for the HarmonyOS kits, shaped like the API 12 signatures in `kits.d.ts`.
 * Tests drive the system through `sim`.
 */
export const sim = {
  files: new Map(),
  prefs: new Map(),
  requests: [],
  respond: (req) => ({ responseCode: 200, result: req.method === 'GET' ? '{"t":3,"i":1,"cs":{"req":false}}' : '{"ok":true}' }),
  appCallbacks: { abilityLifecycle: [], applicationStateChange: [] },
  observers: { navDestinationUpdate: [], routerPageUpdate: [] },
  watchers: new Map(),
  device: { ODID: 'A1B2C3D4-0000-4000-8000-1234567890AB', deviceType: 'phone' },
  reset() {
    this.files.clear();
    this.prefs.clear();
    this.requests.length = 0;
    this.appCallbacks.abilityLifecycle.length = 0;
    this.appCallbacks.applicationStateChange.length = 0;
    this.observers.navDestinationUpdate.length = 0;
    this.observers.routerPageUpdate.length = 0;
    this.watchers.clear();
    this.device = { ODID: 'A1B2C3D4-0000-4000-8000-1234567890AB', deviceType: 'phone' };
  },
};

const applicationContext = {
  filesDir: '/data/app/files',
  getApplicationContext: () => applicationContext,
  on(type, cb) {
    sim.appCallbacks[type].push(cb);
    return sim.appCallbacks[type].length;
  },
};
export const mockContext = applicationContext;

export const common = {};
export class UIAbility {}
export class AbilityLifecycleCallback {}
export const bundleManager = {
  BundleFlag: { GET_BUNDLE_INFO_DEFAULT: 0 },
  getBundleInfoForSelfSync: () => ({ name: 'com.example.harmony', versionName: '1.4.0', versionCode: 140 }),
};

export const preferences = {
  getPreferencesSync(_ctx, { name }) {
    if (!sim.prefs.has(name)) sim.prefs.set(name, new Map());
    const m = sim.prefs.get(name);
    return {
      getSync: (k, d) => (m.has(k) ? m.get(k) : d),
      hasSync: (k) => m.has(k),
      putSync: (k, v) => void m.set(k, v),
      deleteSync: (k) => void m.delete(k),
      flush: () => Promise.resolve(),
    };
  },
};

const fds = new Map();
let nextFd = 3;
export const fileIo = {
  OpenMode: { READ_ONLY: 0o0, WRITE_ONLY: 0o1, READ_WRITE: 0o2, CREATE: 0o100, TRUNC: 0o1000, APPEND: 0o2000 },
  accessSync: (p) => sim.files.has(p) || [...sim.files.keys()].some((k) => k.startsWith(`${p}/`)) || p.endsWith('/tc_queue'),
  mkdirSync: () => undefined,
  readTextSync: (p) => {
    if (!sim.files.has(p)) throw new Error(`ENOENT ${p}`);
    return sim.files.get(p);
  },
  openSync: (p, mode) => {
    const fd = nextFd++;
    if (mode & 0o1000 || !sim.files.has(p)) sim.files.set(p, '');
    fds.set(fd, p);
    return { fd };
  },
  writeSync: (fd, s) => {
    const p = fds.get(fd);
    sim.files.set(p, sim.files.get(p) + s);
    return s.length;
  },
  closeSync: (f) => void fds.delete(typeof f === 'number' ? f : f.fd),
  renameSync: (a, b) => {
    sim.files.set(b, sim.files.get(a));
    sim.files.delete(a);
  },
  unlinkSync: (p) => void sim.files.delete(p),
};

export const http = {
  RequestMethod: { GET: 'GET', POST: 'POST' },
  HttpDataType: { STRING: 0, OBJECT: 1, ARRAY_BUFFER: 2 },
  createHttp() {
    let destroyed = false;
    return {
      request(url, opts) {
        if (destroyed) return Promise.reject(new Error('destroyed'));
        const req = { url, method: opts.method, header: opts.header, body: opts.extraData };
        sim.requests.push(req);
        try {
          return Promise.resolve(sim.respond(req));
        } catch (e) {
          return Promise.reject(e);
        }
      },
      destroy() {
        destroyed = true;
      },
    };
  },
};

export const connection = {
  NetBearType: { BEARER_CELLULAR: 0, BEARER_WIFI: 1, BEARER_ETHERNET: 3 },
  getDefaultNet: () => Promise.resolve({ netId: 100 }),
  getNetCapabilities: () => Promise.resolve({ bearerTypes: [1] }),
};

export const display = { getDefaultDisplaySync: () => ({ width: 1260, height: 2720, densityPixels: 3.5 }) };

export const uiObserver = {
  NavDestinationState: { ON_SHOWN: 0, ON_HIDDEN: 1 },
  RouterPageState: { ABOUT_TO_APPEAR: 0, ABOUT_TO_DISAPPEAR: 1, ON_PAGE_SHOW: 2, ON_PAGE_HIDE: 3, ON_BACK_PRESS: 4 },
  on(type, a, b) {
    sim.observers[type].push(b ?? a);
  },
};

export const process = { getStartRealtime: () => 1000 };

export const deviceInfo = new Proxy(
  {},
  {
    get(_t, k) {
      const base = { brand: 'HUAWEI', productModel: 'ALN-AL00', osFullName: 'OpenHarmony-5.0.0.71', distributionOSName: 'HarmonyOS', distributionOSVersion: '5.0.0' };
      return k in sim.device ? sim.device[k] : base[k];
    },
  },
);

export const systemDateTime = { TimeType: { STARTUP: 0, ACTIVE: 1 }, getUptime: () => 1820 };

export const i18n = {
  System: { getSystemLocale: () => 'zh-Hans-CN' },
  getTimeZone: () => ({ getID: () => 'Asia/Shanghai' }),
};

export const cryptoFramework = {
  createRandom: () => ({
    generateRandomSync: (n) => ({ data: Uint8Array.from({ length: n }, () => Math.floor(Math.random() * 256)) }),
  }),
};

export const hilog = { debug: () => undefined, warn: () => undefined };

export const hiAppEvent = {
  domain: { OS: 'OS' },
  event: { APP_CRASH: 'APP_CRASH', APP_FREEZE: 'APP_FREEZE' },
  addWatcher(w) {
    sim.watchers.set(w.name, w);
    return {};
  },
  removeWatcher(w) {
    sim.watchers.delete(w.name);
  },
};
