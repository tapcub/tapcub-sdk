/**
 * React Native 桥接：公开 API 全部转到 TapCubCore；页面只由 navigationHook 产生 $screen_view。
 */
import { TapCubCore, type Adapters, type Props, type TapCubConfig } from '@tapcub/app-sdk';
import { rnAdapters, type RnHost } from './adapters.ts';

export type NavigationStateLike = {
  index?: number;
  routes?: Array<{ name?: string; state?: NavigationStateLike }>;
};

function activeRouteName(state?: NavigationStateLike | null): string | undefined {
  if (!state || !Array.isArray(state.routes) || !state.routes.length) return undefined;
  const i = Math.min(state.index ?? state.routes.length - 1, state.routes.length - 1);
  const r = state.routes[i];
  if (!r) return undefined;
  if (r.state) return activeRouteName(r.state) || r.name;
  return r.name;
}

class RnBridge {
  private core: TapCubCore | null = null;
  private adapters: Adapters | null = null;
  private lastScreen: string | undefined;

  /** 测试或自定义宿主：注入适配（不 require react-native） */
  attach(adapters: Adapters): TapCubCore {
    this.adapters = adapters;
    this.core = new TapCubCore(adapters);
    this.lastScreen = undefined;
    return this.core;
  }

  preInit(config: TapCubConfig, host?: RnHost): this {
    const core = this.core ?? this.attach(rnAdapters(host || {}));
    core.preInit(config);
    return this;
  }

  init(config?: TapCubConfig): Promise<void> {
    if (!this.core) this.preInit(config || { siteKey: '' });
    return this.core!.init(config);
  }

  private api(): TapCubCore {
    if (!this.core) throw new Error('TapCub.preInit() first');
    return this.core;
  }

  track(name: string, props?: Props): void {
    this.api().track(name, props);
  }
  trackScreen(name: string, props?: Props): void {
    this.lastScreen = name;
    this.api().trackScreen(name, props);
  }
  login(id: string | number, props?: Props, opts?: { type?: 'login' | 'email' | 'mobile' | 'openid' | 'unionid' | 'custom' }): void {
    this.api().login(id, props, opts);
  }
  logout(): void {
    this.api().logout();
  }
  bind(ids: Record<string, string>): void {
    this.api().bind(ids);
  }
  setProps(props: Props): void {
    this.api().setProps(props);
  }
  flush(): void {
    this.api().flush();
  }
  grantConsent(p: Array<'analytics' | 'functional' | 'marketing'> | number): void {
    this.api().grantConsent(p);
  }
  optOut(): void {
    this.api().optOut();
  }
  optIn(): void {
    this.api().optIn();
  }
  getDeviceId(): string | null {
    return this.api().getDeviceId();
  }
  getSessionId(): string | null {
    return this.api().getSessionId();
  }
  getState() {
    return this.api().getState();
  }

  /**
   * React Navigation：`<NavigationContainer onStateChange={TapCub.navigationHook}>`
   * 嵌套路由取最内层 name；与上次相同则不重复 $screen_view。
   */
  navigationHook = (state?: NavigationStateLike | null): string | undefined => {
    const name = activeRouteName(state);
    if (!name || name === this.lastScreen) return name;
    this.lastScreen = name;
    this.core?.trackScreen(name);
    return name;
  };
}

export const TapCub = new RnBridge();
export { rnAdapters, createRnStorage, hydrateRnStorage, RN_STORAGE_KEYS } from './adapters.ts';
export { nativeCrashHook, toCrashEvent } from './native-crash.ts';
export type { NativeCrashModule, NativeCrashRecord } from './native-crash.ts';
export { activeRouteName };
export { TapCubCore } from '@tapcub/app-sdk';
export default TapCub;
