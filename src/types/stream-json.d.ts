// --- stream-chain ---
declare module 'stream-chain' {
    import { Transform } from 'stream';
    export function chain(steps: Array<NodeJS.ReadableStream | Transform>): Transform;
  }
  
  // --- stream-json main parser ---
  declare module 'stream-json' {
    import { Transform } from 'stream';
    export function parser(): Transform;
  }
  
  // --- stream-json streamers ---
  declare module 'stream-json/streamers/StreamValues' {
    import { Transform } from 'stream';
    export function streamValues(): Transform;
  }
  
  declare module 'stream-json/streamers/StreamObject' {
    import { Transform } from 'stream';
    export function streamObject(): Transform;
  }
  
  declare module 'stream-json/streamers/StreamArray' {
    import { Transform } from 'stream';
    export function streamArray(): Transform;
  }