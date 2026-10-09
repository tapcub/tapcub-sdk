/** ArkTS runtime globals (no DOM / Node typings in the HAR). */
declare function setTimeout(fn: () => void, ms?: number): number;
declare function clearTimeout(id?: number): void;
declare function setInterval(fn: () => void, ms?: number): number;
declare function clearInterval(id?: number): void;
