import type { AbilityLifecycleCallback, UIAbility, common } from '@kit.AbilityKit';
import { uiObserver } from '@kit.ArkUI';
import { process } from '@kit.ArkTS';
import { systemDateTime } from '@kit.BasicServicesKit';
import type { LaunchInfo, Lifecycle, LifecycleHandlers, PageInfo } from '../core/types';

/**
 * Cold launch = first ability to reach the foreground (needs `preInit` in `AbilityStage.onCreate` or
 * `EntryAbility.onCreate`). Foreground / background come from `applicationStateChange`, so switching between
 * two abilities is not a background. Pages come from UIObserver for both router and Navigation.
 */
export class AppLifecycle implements Lifecycle {
  static readonly ignored = new Set<string>();

  private h: LifecycleHandlers | null = null;
  private page: PageInfo | null = null;
  private launched = false;
  private foreground = false;
  private launchUri: string | undefined;

  constructor(
    private readonly app: common.ApplicationContext,
    private readonly autoScreens: boolean,
  ) {}

  bind(h: LifecycleHandlers): void {
    this.h = h;
    this.app.on('abilityLifecycle', this.abilityCallbacks());
    this.app.on('applicationStateChange', {
      onApplicationForeground: () => {
        if (!this.launched || this.foreground) return;
        this.foreground = true;
        h.onShow({});
      },
      onApplicationBackground: () => {
        if (!this.launched || !this.foreground) return;
        this.foreground = false;
        h.onHide();
      },
    });
    if (this.autoScreens) {
      uiObserver.on('navDestinationUpdate', (info) => {
        const name = typeof info.name === 'string' ? info.name : '';
        if (info.state === uiObserver.NavDestinationState.ON_SHOWN) this.showPage(name);
        else if (info.state === uiObserver.NavDestinationState.ON_HIDDEN) this.hidePage(name);
      });
    }
  }

  currentPage(): PageInfo | null {
    return this.page;
  }

  private abilityCallbacks(): AbilityLifecycleCallback {
    const noop = (): void => undefined;
    return {
      onAbilityCreate: (ability: UIAbility) => {
        if (!this.launched) this.launchUri = ability.launchWant?.uri || undefined;
        if (this.autoScreens) {
          uiObserver.on('routerPageUpdate', ability.context, (info) => {
            const name = info.name || info.path;
            if (info.state === uiObserver.RouterPageState.ON_PAGE_SHOW) this.showPage(name);
            else if (info.state === uiObserver.RouterPageState.ON_PAGE_HIDE) this.hidePage(name);
          });
        }
      },
      onAbilityForeground: () => {
        if (this.launched || !this.h) return;
        this.launched = true;
        this.foreground = true;
        const dur = coldStartMs();
        const info: LaunchInfo = { path: this.launchUri, query: dur == null ? {} : { duration_ms: String(dur) } };
        this.h.onLaunch(info);
      },
      onWindowStageCreate: noop,
      onWindowStageActive: noop,
      onWindowStageInactive: noop,
      onWindowStageDestroy: noop,
      onAbilityDestroy: noop,
      onAbilityBackground: noop,
      onAbilityContinue: noop,
    } as AbilityLifecycleCallback;
  }

  private showPage(name: string): void {
    if (!name || !this.h || AppLifecycle.ignored.has(name)) return;
    if (this.page?.path === name) return;
    if (this.page) this.h.onPageHide(this.page);
    this.page = { path: name };
    this.h.onPageShow(this.page);
  }

  private hidePage(name: string): void {
    if (!this.h || !this.page || this.page.path !== name) return;
    const p = this.page;
    this.page = null;
    this.h.onPageHide(p);
  }
}

/** Process start → first foreground ability, in ms since boot. Null when either clock is unavailable. */
function coldStartMs(): number | null {
  try {
    const now = systemDateTime.getUptime(systemDateTime.TimeType.STARTUP, false);
    const ms = Math.round(now - process.getStartRealtime());
    return ms > 0 && ms < 60_000 ? ms : null;
  } catch {
    return null;
  }
}
