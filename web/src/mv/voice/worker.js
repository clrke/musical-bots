// Voice worker (module worker): renders sung lines off the main thread.
//   in:  { id, job }                     (job: see renderLine in ./sing.js)
//   out: { id, result } | { id, error }  (result.pcm.buffer is transferred)
// Created by ./pool.js with new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }).

import { renderLine } from './sing.js';

/**
 * Handle one request; returns the reply and its transfer list (exported for tests).
 * @returns {{reply: {id: any, result?: object, error?: string}, transfer: ArrayBuffer[]}}
 */
export function handleRequest(data) {
  const id = data?.id;
  try {
    const result = renderLine(data?.job);
    return { reply: { id, result }, transfer: [result.pcm.buffer] };
  } catch (err) {
    return { reply: { id, error: err instanceof Error ? err.message : String(err) }, transfer: [] };
  }
}

const scope = typeof self !== 'undefined' ? self : null;
if (scope && typeof scope.postMessage === 'function' && typeof scope.addEventListener === 'function' && typeof window === 'undefined') {
  scope.addEventListener('message', (ev) => {
    const { reply, transfer } = handleRequest(ev.data);
    scope.postMessage(reply, transfer);
  });
}
