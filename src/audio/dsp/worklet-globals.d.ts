/**
 * The AudioWorklet global scope is not in the app tsconfig's DOM typings as a value.
 * These names exist only inside the processor module.
 */

declare class AudioWorkletProcessor {
  readonly port: MessagePort
}

declare function registerProcessor(
  name: string,
  processorCtor: new () => AudioWorkletProcessor,
): void

declare const sampleRate: number
