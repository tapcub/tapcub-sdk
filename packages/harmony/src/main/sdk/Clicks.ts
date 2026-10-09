import type { AutoTrackHook, PageInfo } from '../core/types';

type ClickSink = (el: { type?: string; id?: string; content?: string; path?: string }, page: PageInfo | null) => void;

/**
 * ArkUI has no public global click interceptor, so `$app_click` is manual (`TapCub.trackClick`). Routing it
 * through the autotrack hook keeps the same event shape and the server `autotrack` / element blacklist switches.
 */
export class ManualClicks implements AutoTrackHook {
  private sink: ClickSink | null = null;

  constructor(private readonly currentPage: () => PageInfo | null) {}

  enable(cb: ClickSink): void {
    this.sink = cb;
  }

  disable(): void {
    this.sink = null;
  }

  click(id: string, content?: string, type = 'Button'): void {
    const page = this.currentPage();
    this.sink?.({ type, id, content, path: page ? `${page.path}/${id}` : id }, page);
  }
}
