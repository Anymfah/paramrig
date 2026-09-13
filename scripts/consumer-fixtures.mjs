const audioSource = `import { defaultPatch, renderPatch } from '@paramrig/audio'; import { encodeWav } from '@paramrig/audio/wav';
const patch = defaultPatch(); patch.duration = 0.1;
const a = renderPatch(patch, 16000, 64), b = renderPatch(patch, 16000, 257);
if (a.left.some((value, i) => !Number.isFinite(value) || value !== b.left[i])) throw Error('Block rendering changed');
if (!a.left.some(value => value !== 0)) throw Error('Silent default patch');
if (encodeWav(a, 16000).length !== 44 + 4 * a.left.length) throw Error('Invalid WAV length');
export const result = a;`
export const fixtures = {
  core: { packages: ['core'], node: `import { evaluateExpression, normalizeValue } from '@paramrig/core'; if (evaluateExpression('2 + 3', () => 0) !== 5) throw Error('Expression failed'); export const result = normalizeValue;` },
  audio: { packages: ['core', 'audio'], node: audioSource, budget: 30000 },
  'audio-labs': { packages: ['core', 'audio', 'audio-labs'], node: `import * as labs from '@paramrig/audio-labs'; import { renderPatch } from '@paramrig/audio';
const sound = labs.generateSound({ ...labs.DEFAULT_CRITERIA, type: 'notification', minMs: 100, maxMs: 300 }, 171);
const saved = JSON.parse(JSON.stringify(sound));
const a = renderPatch(sound.patch, 16000, 64), b = renderPatch(saved.patch, 16000, 257);
if (a.left.some((value, i) => value !== b.left[i] || !Number.isFinite(value))) throw Error('Saved patch replay changed');
export const result = labs;`, budget: 90000 },
  'audio-browser': { packages: ['core', 'audio', 'audio-browser'], browser: `export { createAudioPlayer, audioWorkletUrl } from '@paramrig/audio-browser'; export { defaultPatch, renderPatch } from '@paramrig/audio'; export { encodeWav } from '@paramrig/audio/wav';` },
  vector: { packages: ['core', 'vector'], node: `import { createVectorDocument, createVectorElement, serializeProject, importProject, resolveRigValues } from '@paramrig/vector';
const doc = createVectorDocument(); doc.elements.push(createVectorElement('rectangle', { x: 10, y: 20, width: 40, height: 60 }));
const saved = importProject(serializeProject(doc)); if (!saved.ok || saved.project.document.id !== doc.id) throw Error('Vector serialization failed');
  export const result = resolveRigValues(saved.project.document, {});`, browser: `export { createVectorRenderer } from '@paramrig/vector/browser'; export { createVectorDocument, createVectorElement, resolveRigValues } from '@paramrig/vector'; export { exportPdf, pdfPages } from '@paramrig/vector/pdf';` },
  scene: { packages: ['core', 'scene'], node: `import { createSceneDocument, serializeProject, importProject, resolveSceneValues } from '@paramrig/scene';
const doc = createSceneDocument(); const saved = importProject(serializeProject(doc));
if (!saved.ok || saved.project.document.id !== doc.id) throw Error('Scene serialization failed'); export const result = resolveSceneValues(doc, {});`,
    browser: `export { createSceneDocument, importProject } from '@paramrig/scene'; export { createSceneInstance } from '@paramrig/scene/engine'; export { createSceneViewer } from '@paramrig/scene/browser'; import { Scene, WebGLRenderer } from 'three'; export const THREE = { Scene, WebGLRenderer };` },

  controls: { packages: ['core', 'controls'], extra: ['react@19.2.0', 'react-dom@19.2.0', '@types/react-dom@19.2.7'],
    node: `import { createElement } from 'react'; import { renderToString } from 'react-dom/server'; import { ParameterControl } from '@paramrig/controls';
const html = renderToString(createElement(ParameterControl, {param:{kind:'number',id:'gain',group:'main',label:'Gain',min:0,max:1,step:0.01,defaultValue:0.5},value:0.5,onChange:()=>{}})); if(!html.includes('Gain')) throw Error('SSR control failed'); export const result = html;`,
    browser: `export { RigControls, ParameterControl, createControlRegistry } from '@paramrig/controls'; export { createElement, useState } from 'react'; export { createRoot } from 'react-dom/client'; import '@paramrig/controls/styles.css';` },

  'vector-controls': { packages: ['core', 'vector', 'controls'], extra: ['react@19.2.0', 'react-dom@19.2.0', '@types/react-dom@19.2.7'],
    browser: `export { createVectorDocument, createVectorElement } from '@paramrig/vector'; export { createVectorRenderer } from '@paramrig/vector/browser'; export { RigControls } from '@paramrig/controls'; export { createElement, useState, useEffect, useRef } from 'react'; export { createRoot } from 'react-dom/client'; import '@paramrig/controls/styles.css';` },

}
