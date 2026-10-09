import { bundleManager, type common } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { TapCubCore } from '../core/sdk';
import type { ConsentListener, ErrorListener, SessionListener } from '../core/sdk';
import type { ConsentPurpose, CrashEvent, LoginIdType, Props, RemoteConfig, SdkState, TapCubConfig } from '../core/types';
import { Brand } from './Brand';
import { ManualClicks } from './Clicks';
import { CrashReporter } from './Crash';
import { SystemDevice } from './Device';
import { AppLifecycle } from './Lifecycle';
import { DeviceStorage } from './Storage';
import { HttpTransport } from './Transport';
import { ArkTimers } from './Timers';

/** Native default: a larger on-disk queue than the mini-program 1 MB limit. */
const NATIVE_QUEUE = { maxEvents: 10_000, maxDays: 7, maxStorageBytes: 8 * 1_048_576 };

class TapCubSdk {
  private core: TapCubCore | null = null;
  private clicks: ManualClicks | null = null;

  /**
   * Stores config and binds lifecycle only: no collection, no device reads, no network until `init()`.
   * Call from `AbilityStage.onCreate` or `EntryAbility.onCreate`.
   */
  preInit(context: common.Context, config: TapCubConfig): void {
    if (this.core) return;
    if (!config || !config.siteKey) throw new Error('siteKey required');
    const app = context.getApplicationContext();
    const cfg: TapCubConfig = { ...config, queue: config.queue ?? NATIVE_QUEUE };
    if (cfg.appId == null || cfg.appVersion == null || cfg.appBuild == null) {
      try {
        const info = bundleManager.getBundleInfoForSelfSync(bundleManager.BundleFlag.GET_BUNDLE_INFO_DEFAULT);
        cfg.appId ??= info.name;
        cfg.appVersion ??= info.versionName;
        cfg.appBuild ??= String(info.versionCode);
      } catch {
        // bundle info unavailable (tests); the collector rejects an empty appId with a clear error
      }
    }
    const storage = new DeviceStorage(app);
    const lifecycle = new AppLifecycle(app, cfg.autoTrackScreens !== false);
    const clicks = cfg.autoTrack === false ? null : new ManualClicks(() => lifecycle.currentPage());
    const debug = cfg.debug === true;
    const core = new TapCubCore({
      storage,
      transport: new HttpTransport(),
      lifecycle,
      device: new SystemDevice(storage),
      timers: new ArkTimers(),
      autoTrack: clicks ?? undefined,
      crash: cfg.crashReport === false ? undefined : new CrashReporter(),
      log: (level, msg) => {
        if (!debug) return;
        if (level === 'error') hilog.warn(Brand.LOG_DOMAIN, Brand.LOG_TAG, '%{public}s', msg);
        else hilog.debug(Brand.LOG_DOMAIN, Brand.LOG_TAG, '%{public}s', msg);
      },
    });
    this.core = core;
    this.clicks = clicks;
    core.preInit(cfg);
  }

  /** Fetches remote config and starts collecting (after consent when the site requires it). */
  init(): Promise<void> {
    return this.api().init();
  }

  track(name: string, props?: Props): void {
    this.api().track(name, props);
  }
  trackScreen(name: string, props?: Props): void {
    this.api().trackScreen(name, props);
  }
  /** `$app_click` for ArkUI components: call from `onClick`. */
  trackClick(id: string, content?: string, type?: string): void {
    this.api();
    this.clicks?.click(id, content, type);
  }
  flush(): void {
    this.api().flush();
  }
  login(id: string | number, props?: Props, type?: LoginIdType): void {
    this.api().login(id, props, type ? { type } : undefined);
  }
  logout(): void {
    this.api().logout();
  }
  bind(ids: Partial<Record<LoginIdType, string>>): void {
    this.api().bind(ids);
  }
  setProps(props: Props): void {
    this.api().setProps(props);
  }
  setPropsOnce(props: Props): void {
    this.api().setPropsOnce(props);
  }
  unsetProps(keys: string[]): void {
    this.api().unsetProps(keys);
  }
  setGroup(type: string, id?: string | number | null, traits?: Props): void {
    this.api().setGroup(type, id, traits);
  }
  reset(): void {
    this.api().reset();
  }
  anonymize(): void {
    this.api().anonymize();
  }
  grantConsent(purposes: ConsentPurpose[] | number): void {
    this.api().grantConsent(purposes);
  }
  revokeConsent(): void {
    this.api().revokeConsent();
  }
  getConsent(): number {
    return this.api().getConsent();
  }
  optOut(): void {
    this.api().optOut();
  }
  optIn(): void {
    this.api().optIn();
  }
  setRestricted(on: boolean): void {
    this.api().setRestricted(on);
  }
  setChildMode(on: boolean): void {
    this.api().setChildMode(on);
  }
  setDataRegion(region: 'eu' | 'us' | 'cn'): void {
    this.api().setDataRegion(region);
  }
  shouldPrompt(): boolean {
    return this.api().shouldPrompt();
  }
  stop(): void {
    this.api().stop();
  }
  start(): void {
    this.api().start();
  }
  registerSuperProps(props: Props): void {
    this.api().registerSuperProps(props);
  }
  unregisterSuperProp(key: string): void {
    this.api().unregisterSuperProp(key);
  }
  trackPurchase(info: Props): void {
    this.api().trackPurchase(info);
  }
  trackPushClick(payload: Props): void {
    this.api().trackPushClick(payload);
  }
  setAttribution(attrs: Props): void {
    this.api().setAttribution(attrs);
  }
  trackDeeplink(url: string, referrer?: string): void {
    this.api().trackDeeplink(url, referrer);
  }
  reportException(ev: CrashEvent): void {
    this.api().reportException(ev);
  }
  getDeviceId(): string | null {
    return this.api().getDeviceId();
  }
  getSessionId(): string | null {
    return this.api().getSessionId();
  }
  getRemoteConfig(): Readonly<RemoteConfig> {
    return this.api().getRemoteConfig();
  }
  getState(): SdkState {
    return this.api().getState();
  }
  onConsentChange(cb: ConsentListener): void {
    this.api().onConsentChange(cb);
  }
  onSessionStart(cb: SessionListener): void {
    this.api().onSessionStart(cb);
  }
  onError(cb: ErrorListener): void {
    this.api().onError(cb);
  }
  /** Skips automatic `$screen_view` for a router page or NavDestination name. */
  ignoreScreen(name: string): void {
    AppLifecycle.ignored.add(name);
  }

  private api(): TapCubCore {
    if (!this.core) throw new Error('TapCub.preInit(context, config) first');
    return this.core;
  }
}

export const TapCub = new TapCubSdk();
