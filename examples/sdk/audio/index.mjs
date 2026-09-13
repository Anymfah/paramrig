import { defaultPatch, renderPatch } from '@paramrig/audio'; import { encodeWav } from '@paramrig/audio/wav';
const patch = defaultPatch(); patch.duration = 0.1;
const a = renderPatch(patch, 16000, 64), b = renderPatch(patch, 16000, 257);
if (a.left.some((value, i) => !Number.isFinite(value) || value !== b.left[i])) throw Error('Block rendering changed');
if (!a.left.some(value => value !== 0)) throw Error('Silent default patch');
if (encodeWav(a, 16000).length !== 44 + 4 * a.left.length) throw Error('Invalid WAV length');
export const result = a;
console.log('audio: public API completed successfully')
