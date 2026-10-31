// MAIN-world agent. Runs in the page's own JavaScript context at
// document_start, so it can see objects the fetched page created on itself
// (`window.ytInitialData`, `#movie_player`, `hls` instances) that an isolated
// content script cannot reach on Chromium.
//
// The bridge is deliberately synchronous: the isolated world dispatches a
// request CustomEvent on the <video> (or on documentElement for page-level
// operations), and this agent answers on the same event target. Blink runs
// listeners from both worlds during the same dispatch, so the caller gets its
// value back before dispatchEvent returns.
//
// Phase 1 is a stub: `ping` and `engines` only. Phase 2 replaces this with the
// real adapter facade (quality, captions, audio tracks, chapters, fullscreen).
const EVENT_REQUEST = 'nocturne:req';
const EVENT_RESPONSE = 'nocturne:res';

const reply = (target, detail) => {
  const node =
    target && typeof target.dispatchEvent === 'function'
      ? target
      : document.documentElement;
  node.dispatchEvent(new CustomEvent(EVENT_RESPONSE, { detail }));
};

const onRequest = (event) => {
  const request = event.detail;
  if (request === null || typeof request !== 'object') return;

  const rid = request.rid;
  const op = request.op;

  if (op === 'ping') {
    reply(event.target, { rid, ok: true, value: 'pong' });
    return;
  }

  if (op === 'engines') {
    reply(event.target, { rid, ok: true, value: {} });
    return;
  }

  reply(event.target, { rid, ok: false, error: 'unknown-op' });
};

// Capture phase: a site's own player cannot swallow the request on its way
// down, and event.target is still the element the isolated world chose.
document.addEventListener(EVENT_REQUEST, onRequest, true);