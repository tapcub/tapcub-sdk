import { http } from '@kit.NetworkKit';
import type { Transport, TransportResponse } from '../core/types';

/** `@ohos.net.http`, one request object per call. Network errors reject; the core backs off. */
export class HttpTransport implements Transport {
  post(url: string, body: string, headers: Record<string, string>): Promise<TransportResponse> {
    return this.request(url, http.RequestMethod.POST, headers, body);
  }

  get(url: string): Promise<TransportResponse> {
    return this.request(url, http.RequestMethod.GET, {});
  }

  private async request(url: string, method: http.RequestMethod, headers: Record<string, string>, body?: string): Promise<TransportResponse> {
    const req = http.createHttp();
    try {
      const res = await req.request(url, {
        method,
        header: headers,
        extraData: body,
        expectDataType: http.HttpDataType.STRING,
        usingCache: false,
        connectTimeout: 10_000,
        readTimeout: 15_000,
      });
      return { status: res.responseCode, body: typeof res.result === 'string' ? res.result : '' };
    } finally {
      req.destroy();
    }
  }
}
