/**
 * Minimal declarations of the HarmonyOS kits the HAR uses, copied from the API 12 SDK signatures, so `tsc`
 * can type-check the adapters without DevEco. Only the members the SDK touches are declared; keep them in step
 * with the real `.d.ts` when the SDK starts using something new.
 */
interface WcStubContext {
  filesDir: string;
  getApplicationContext(): import('@kit.AbilityKit').common.ApplicationContext;
}

declare module '@kit.AbilityKit' {
  export namespace common {
    type Context = WcStubContext;
    interface UIAbilityContext extends WcStubContext {}
    interface ApplicationContext extends WcStubContext {
      on(type: 'abilityLifecycle', callback: AbilityLifecycleCallback): number;
      on(type: 'applicationStateChange', callback: ApplicationStateChangeCallback): void;
    }
  }
  export interface Want {
    uri?: string;
  }
  export class UIAbility {
    context: common.UIAbilityContext;
    launchWant: Want;
  }
  export class AbilityLifecycleCallback {
    onAbilityCreate(ability: UIAbility): void;
    onWindowStageCreate(ability: UIAbility, windowStage: object): void;
    onWindowStageActive(ability: UIAbility, windowStage: object): void;
    onWindowStageInactive(ability: UIAbility, windowStage: object): void;
    onWindowStageDestroy(ability: UIAbility, windowStage: object): void;
    onAbilityDestroy(ability: UIAbility): void;
    onAbilityForeground(ability: UIAbility): void;
    onAbilityBackground(ability: UIAbility): void;
    onAbilityContinue(ability: UIAbility): void;
  }
  export interface ApplicationStateChangeCallback {
    onApplicationForeground(): void;
    onApplicationBackground(): void;
  }
  export namespace bundleManager {
    enum BundleFlag {
      GET_BUNDLE_INFO_DEFAULT = 0,
    }
    interface BundleInfo {
      readonly name: string;
      readonly versionName: string;
      readonly versionCode: number;
    }
    function getBundleInfoForSelfSync(bundleFlags: number): BundleInfo;
  }
}

declare module '@kit.ArkData' {
  export namespace preferences {
    type ValueType = number | string | boolean | Array<number> | Array<string> | Array<boolean> | Uint8Array | object | bigint;
    interface Options {
      name: string;
      dataGroupId?: string | null;
    }
    interface Preferences {
      getSync(key: string, defValue: ValueType): ValueType;
      hasSync(key: string): boolean;
      putSync(key: string, value: ValueType): void;
      deleteSync(key: string): void;
      flush(): Promise<void>;
    }
    function getPreferencesSync(context: WcStubContext, options: Options): Preferences;
  }
}

declare module '@kit.CoreFileKit' {
  export namespace fileIo {
    namespace OpenMode {
      const READ_ONLY = 0o0;
      const WRITE_ONLY = 0o1;
      const READ_WRITE = 0o2;
      const CREATE = 0o100;
      const TRUNC = 0o1000;
      const APPEND = 0o2000;
    }
    interface File {
      readonly fd: number;
    }
    function accessSync(path: string): boolean;
    function mkdirSync(path: string): void;
    function readTextSync(filePath: string): string;
    function openSync(path: string, mode?: number): File;
    function writeSync(fd: number, buffer: ArrayBuffer | string): number;
    function closeSync(file: number | File): void;
    function renameSync(oldPath: string, newPath: string): void;
    function unlinkSync(path: string): void;
  }
}

declare module '@kit.NetworkKit' {
  export namespace http {
    enum RequestMethod {
      GET = 'GET',
      POST = 'POST',
    }
    enum HttpDataType {
      STRING = 0,
      OBJECT = 1,
      ARRAY_BUFFER = 2,
    }
    interface HttpRequestOptions {
      method?: RequestMethod;
      extraData?: string | object | ArrayBuffer;
      expectDataType?: HttpDataType;
      usingCache?: boolean;
      header?: object;
      readTimeout?: number;
      connectTimeout?: number;
    }
    interface HttpResponse {
      result: string | object | ArrayBuffer;
      responseCode: number;
    }
    interface HttpRequest {
      request(url: string, options?: HttpRequestOptions): Promise<HttpResponse>;
      destroy(): void;
    }
    function createHttp(): HttpRequest;
  }
  export namespace connection {
    enum NetBearType {
      BEARER_CELLULAR = 0,
      BEARER_WIFI = 1,
      BEARER_ETHERNET = 3,
    }
    interface NetHandle {
      netId: number;
    }
    interface NetCapabilities {
      bearerTypes: Array<NetBearType>;
    }
    function getDefaultNet(): Promise<NetHandle>;
    function getNetCapabilities(netHandle: NetHandle): Promise<NetCapabilities>;
  }
}

declare module '@kit.ArkUI' {
  export namespace display {
    interface Display {
      width: number;
      height: number;
      densityPixels: number;
    }
    function getDefaultDisplaySync(): Display;
  }
  export namespace uiObserver {
    enum NavDestinationState {
      ON_SHOWN = 0,
      ON_HIDDEN = 1,
    }
    enum RouterPageState {
      ABOUT_TO_APPEAR = 0,
      ABOUT_TO_DISAPPEAR = 1,
      ON_PAGE_SHOW = 2,
      ON_PAGE_HIDE = 3,
      ON_BACK_PRESS = 4,
    }
    interface NavDestinationInfo {
      navigationId: string | object;
      name: string | object;
      state: NavDestinationState;
    }
    interface RouterPageInfo {
      index: number;
      name: string;
      path: string;
      state: RouterPageState;
    }
    function on(type: 'navDestinationUpdate', callback: (info: NavDestinationInfo) => void): void;
    function on(type: 'routerPageUpdate', context: import('@kit.AbilityKit').common.UIAbilityContext | object, callback: (info: RouterPageInfo) => void): void;
  }
}

declare module '@kit.ArkTS' {
  export namespace process {
    function getStartRealtime(): number;
  }
}

declare module '@kit.BasicServicesKit' {
  export namespace deviceInfo {
    const brand: string;
    const productModel: string;
    const osFullName: string;
    const distributionOSName: string;
    const distributionOSVersion: string;
    const deviceType: string;
    const ODID: string;
  }
  export namespace systemDateTime {
    enum TimeType {
      STARTUP = 0,
      ACTIVE = 1,
    }
    function getUptime(timeType: TimeType, isNanoseconds?: boolean): number;
  }
}

declare module '@kit.LocalizationKit' {
  export namespace i18n {
    class System {
      static getSystemLocale(): string;
    }
    interface TimeZone {
      getID(): string;
    }
    function getTimeZone(zoneID?: string): TimeZone;
  }
}

declare module '@kit.CryptoArchitectureKit' {
  export namespace cryptoFramework {
    interface DataBlob {
      data: Uint8Array;
    }
    interface Random {
      generateRandomSync(len: number): DataBlob;
    }
    function createRandom(): Random;
  }
}

declare module '@kit.PerformanceAnalysisKit' {
  export namespace hilog {
    function debug(domain: number, tag: string, format: string, ...args: unknown[]): void;
    function warn(domain: number, tag: string, format: string, ...args: unknown[]): void;
  }
  export namespace hiAppEvent {
    namespace domain {
      const OS: 'OS';
    }
    namespace event {
      const APP_CRASH: 'APP_CRASH';
      const APP_FREEZE: 'APP_FREEZE';
    }
    interface AppEventInfo {
      domain: string;
      name: string;
      params: object;
    }
    interface AppEventGroup {
      name: string;
      appEventInfos: Array<AppEventInfo>;
    }
    interface AppEventFilter {
      domain: string;
      names?: string[];
    }
    interface Watcher {
      name: string;
      appEventFilters?: AppEventFilter[];
      onReceive?: (domain: string, appEventGroups: Array<AppEventGroup>) => void;
    }
    function addWatcher(watcher: Watcher): object;
    function removeWatcher(watcher: Watcher): void;
  }
}
