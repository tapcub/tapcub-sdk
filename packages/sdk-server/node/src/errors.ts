import type { TrackResultItem, WireEvent } from './types.ts';

export type TapCubErrorCode =
  /** 401 NO_API_KEY / BAD_API_KEY, 400 VALIDATION and other server codes are passed through */
  | string
  /** network error or timeout after all retries */
  | 'NETWORK'
  /** the server accepted the request but rejected some events (`results[].ok === false`) */
  | 'EVENT_REJECTED'
  /** the queue was full and the oldest events were dropped */
  | 'QUEUE_FULL';

export class TapCubError extends Error {
  override readonly name = 'TapCubError';
  readonly code: TapCubErrorCode;
  /** HTTP status, when there was a response */
  readonly status?: number;
  /** The events that were not stored */
  readonly events: WireEvent[];
  /** Per-event results for EVENT_REJECTED */
  readonly results?: TrackResultItem[];

  constructor(message: string, init: { code: TapCubErrorCode; status?: number; events?: WireEvent[]; results?: TrackResultItem[]; cause?: unknown }) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause });
    this.code = init.code;
    this.status = init.status;
    this.events = init.events ?? [];
    this.results = init.results;
  }
}
