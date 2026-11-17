// Diagnostic overlay gated at build time (--debug / NOCTURNE_DEBUG=1).
// Inert (false) in normal release builds and unit tests.
export const DEBUG_FULLSCREEN = globalThis.__NOCTURNE_DEBUG__ === true;

const MAX_LINES = 60;
const lines = [];
let sink = null;
const t0 = performance.now();

const describe = (node) => {
  if (!node) return 'null';
  const id = node.id ? `#${node.id}` : '';
  const mark =
    node.hasAttribute && node.hasAttribute('data-nocturne-player')
      ? '[stage]'
      : '';
  return `${node.tagName || node.nodeName}${id}${mark}`;
};

const snapshot = () => {
  const o = window.screen.orientation;
  return (
    `fsEl=${describe(document.fullscreenElement)} ` +
    `ori=${o ? `${o.type}:${o.angle}` : '?'} ` +
    `inner=${window.innerWidth}x${window.innerHeight} ` +
    `focus=${document.hasFocus()} hidden=${document.hidden}`
  );
};

export const dbg = (message, withStack = false) => {
  if (!DEBUG_FULLSCREEN) return;
  let text = `${Math.round(performance.now() - t0)}ms ${message}`;
  if (withStack) {
    const stack = String(new Error().stack || '')
      .split('\n')
      .slice(2, 6)
      .map((line) => line.trim())
      .join(' | ');
    text += ` @ ${stack}`;
  }
  lines.push(text);
  if (lines.length > MAX_LINES) lines.shift();
  if (sink) sink.textContent = lines.join('\n');
};

// Mounts a small log box (bottom, tap "copy" to put it on the clipboard) and
// starts listening for the events that matter around a rotate. Returns a
// cleanup function.
export const mountDebugLog = (parent) => {
  if (!DEBUG_FULLSCREEN) return () => {};

  const box = document.createElement('div');
  box.style.cssText =
    'position:absolute;left:0;right:0;bottom:0;max-height:38%;overflow:auto;' +
    'background:rgba(0,0,0,.72);color:#0f0;font:10px monospace;' +
    'z-index:2147483647;' +
    'pointer-events:none;white-space:pre-wrap;';
  const pre = document.createElement('pre');
  pre.style.cssText = 'margin:0;padding:4px;';
  const copy = document.createElement('button');
  copy.textContent = 'copy log';
  copy.style.cssText =
    'position:absolute;right:4px;top:4px;pointer-events:auto;font-size:12px;';
  copy.addEventListener('click', (event) => {
    event.stopPropagation();
    navigator.clipboard
      .writeText(lines.join('\n'))
      .then(() => dbg('log copied'))
      .catch((error) => dbg(`copy failed ${error.name}`));
  });
  box.append(pre, copy);
  parent.append(box);
  sink = pre;
  dbg(`mount ${snapshot()}`);

  const on = [];
  const listen = (target, type, handler, name) => {
    target.addEventListener(type, handler, true);
    on.push(() => target.removeEventListener(type, handler, true));
    return name;
  };
  const note = (label) => () => dbg(`${label} ${snapshot()}`);

  listen(document, 'fullscreenchange', note('fullscreenchange'));
  listen(document, 'fullscreenerror', note('fullscreenerror'));
  listen(document, 'visibilitychange', note('visibilitychange'));
  listen(window, 'resize', note('resize'));
  listen(window, 'orientationchange', note('orientationchange'));
  listen(window, 'blur', note('blur'));
  listen(window, 'focus', note('focus'));
  listen(window, 'pagehide', note('pagehide'));
  if (window.screen.orientation) {
    listen(window.screen.orientation, 'change', note('orientation.change'));
  }
  // Fullscreen calls the MAIN-world patch saw (page scripts).
  listen(document, 'nocturne:dbg', (event) => {
    const detail = event.detail;
    dbg(`MAIN ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  });

  return () => {
    for (const off of on) off();
    sink = null;
    box.remove();
  };
};
