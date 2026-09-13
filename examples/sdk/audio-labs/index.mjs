import * as labs from '@paramrig/audio-labs'; import { renderPatch } from '@paramrig/audio';
const sound = labs.generateSound({ ...labs.DEFAULT_CRITERIA, type: 'notification', minMs: 100, maxMs: 300 }, 171);
const saved = JSON.parse(JSON.stringify(sound));
const a = renderPatch(sound.patch, 16000, 64), b = renderPatch(saved.patch, 16000, 257);
if (a.left.some((value, i) => value !== b.left[i] || !Number.isFinite(value))) throw Error('Saved patch replay changed');
export const result = labs;
console.log('audio-labs: public API completed successfully')
