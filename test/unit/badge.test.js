import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

registerHooks({
  load(url, context, next) {
    if (url.endsWith('.css')) {
      return {
        format: 'module',
        shortCircuit: true,
        source: 'export default "";',
      };
    }
    return next(url, context);
  },
});

const createEmitter = () => {
  const listeners = new Map();
  return {
    addEventListener(type, fn, options) {
      if (!listeners.has(type)) listeners.set(type, new Map());
      const capture =
        typeof options === 'boolean' ? options : Boolean(options?.capture);
      listeners.get(type).set(fn, capture);
    },
    removeEventListener(type, fn, options) {
      const map = listeners.get(type);
      if (!map) return;
      const capture =
        typeof options === 'boolean' ? options : Boolean(options?.capture);
      if (map.get(fn) === capture) map.delete(fn);
    },
    dispatchEvent(event) {
      const map = listeners.get(event.type);
      if (!map) return true;
      for (const fn of Array.from(map.keys())) fn(event);
      return true;
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0;
    },
  };
};

const createElement = (tag) => {
  const emitter = createEmitter();
  const styleProps = new Map();
  const attrs = new Map();
  const children = [];

  const node = {
    tagName: tag.toUpperCase(),
    dataset: {},
    isConnected: false,
    textContent: '',
    style: {
      setProperty(name, value) {
        styleProps.set(name, String(value));
      },
      getPropertyValue(name) {
        return styleProps.get(name) ?? '';
      },
    },
    setAttribute(name, value) {
      attrs.set(name, String(value));
    },
    getAttribute(name) {
      return attrs.get(name) ?? null;
    },
    append(...nodes) {
      for (const child of nodes) {
        children.push(child);
        if (child && typeof child === 'object') child.isConnected = true;
      }
    },
    remove() {
      node.isConnected = false;
    },
    attachShadow() {
      const root = createElement('shadow');
      return root;
    },
    children,
    ...emitter,
  };
  return node;
};

const setupEnv = (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  t.mock.method(performance, 'now', () => Date.now());

  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  const prevRaf = globalThis.requestAnimationFrame;
  const prevCaf = globalThis.cancelAnimationFrame;

  const docEmitter = createEmitter();
  const winEmitter = createEmitter();
  const body = createElement('body');
  body.isConnected = true;

  let nextRaf = 1;
  const rafTimers = new Map();

  globalThis.requestAnimationFrame = (fn) => {
    const id = nextRaf++;
    const timer = setTimeout(() => {
      rafTimers.delete(id);
      fn(Date.now());
    }, 0);
    rafTimers.set(id, timer);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => {
    const timer = rafTimers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      rafTimers.delete(id);
    }
  };

  globalThis.document = {
    body,
    createElement: (tag) => createElement(tag),
    createElementNS: (_ns, tag) => createElement(tag),
    ...docEmitter,
  };
  globalThis.window = {
    innerHeight: 800,
    ...winEmitter,
  };

  t.after(() => {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
    globalThis.requestAnimationFrame = prevRaf;
    globalThis.cancelAnimationFrame = prevCaf;
  });

  return { body, doc: globalThis.document, win: globalThis.window };
};

const createMockVideo = ({ paused = false, rect = null } = {}) => {
  const emitter = createEmitter();
  const box = rect ?? {
    left: 100,
    right: 900,
    top: 100,
    bottom: 550,
    width: 800,
    height: 450,
  };
  return {
    isConnected: true,
    paused,
    getBoundingClientRect: () => box,
    ...emitter,
  };
};

const { createBadge } = await import('../../src/content/controls/badge.js');

const withCapturedBadge = (t) => {
  const env = setupEnv(t);
  const origCreate = env.doc.createElement;
  let capturedButton = null;
  let capturedHost = null;
  env.doc.createElement = (tag) => {
    const node = origCreate(tag);
    if (tag === 'div') {
      const origAttach = node.attachShadow;
      node.attachShadow = () => {
        const shadow = origAttach();
        const origAppend = shadow.append;
        shadow.append = (...nodes) => {
          origAppend(...nodes);
          for (const n of nodes) {
            if (n.tagName === 'BUTTON') capturedButton = n;
          }
        };
        capturedHost = node;
        return shadow;
      };
    }
    return node;
  };
  const badge = createBadge();
  return { ...env, badge, host: capturedHost, button: capturedButton };
};

test('badge stays visible when paused and hides after 2s playing', (t) => {
  const { badge, host } = withCapturedBadge(t);
  const video = createMockVideo({ paused: true });

  badge.show(video);
  t.mock.timers.tick(0);
  assert.equal(host.dataset.revealed, 'true');
  assert.equal(host.style.getPropertyValue('opacity'), '1');

  t.mock.timers.tick(5000);
  assert.equal(host.dataset.revealed, 'true');

  video.paused = false;
  video.dispatchEvent({ type: 'play' });
  assert.equal(host.dataset.revealed, 'true');

  t.mock.timers.tick(1999);
  assert.equal(host.dataset.revealed, 'true');

  t.mock.timers.tick(1);
  assert.equal(host.dataset.revealed, 'false');
  assert.equal(host.style.getPropertyValue('opacity'), '0');
  assert.equal(host.style.getPropertyValue('pointer-events'), 'none');
});

test('hide() removes host & show() re-attaches [B2, A2-1]', (t) => {
  const { badge, host, doc, win, button } = withCapturedBadge(t);
  const video = createMockVideo({ paused: false });

  badge.show(video);
  t.mock.timers.tick(0);
  assert.equal(host.isConnected, true);
  assert.equal(doc.listenerCount('pointermove'), 1);
  assert.equal(win.listenerCount('scroll'), 1);
  assert.equal(button.listenerCount('pointerenter'), 1);

  badge.hide();
  assert.equal(host.isConnected, false);
  assert.equal(doc.listenerCount('pointermove'), 0);
  assert.equal(doc.listenerCount('pointerdown'), 0);
  assert.equal(win.listenerCount('scroll'), 0);
  assert.equal(win.listenerCount('resize'), 0);
  assert.equal(button.listenerCount('pointerenter'), 0);
  assert.equal(video.listenerCount('play'), 0);

  // Re-show after scroll back into view
  badge.show(video);
  t.mock.timers.tick(0);
  assert.equal(host.isConnected, true);
  assert.equal(doc.listenerCount('pointermove'), 1);
  assert.equal(win.listenerCount('scroll'), 1);

  // Let idle expire, then wake via pointermove inside video rect
  t.mock.timers.tick(2000);
  assert.equal(host.dataset.revealed, 'false');
  doc.dispatchEvent({
    type: 'pointermove',
    pointerType: 'mouse',
    clientX: 200,
    clientY: 200,
  });
  assert.equal(host.dataset.revealed, 'true');
  assert.equal(host.style.getPropertyValue('opacity'), '1');
});

test('idle timer does not hide while hovering badge or focused [M2]', (t) => {
  const { badge, host, button } = withCapturedBadge(t);
  const video = createMockVideo({ paused: false });

  badge.show(video);
  t.mock.timers.tick(0);

  // Hover onto badge
  button.dispatchEvent({ type: 'pointerenter' });
  t.mock.timers.tick(4000);
  assert.equal(host.dataset.revealed, 'true');

  // Leave badge -> starts idle hide
  button.dispatchEvent({ type: 'pointerleave' });
  t.mock.timers.tick(2000);
  assert.equal(host.dataset.revealed, 'false');

  // Keyboard focus reveals and holds
  button.dispatchEvent({ type: 'focusin' });
  assert.equal(host.dataset.revealed, 'true');
  t.mock.timers.tick(4000);
  assert.equal(host.dataset.revealed, 'true');

  // Blur resumes idle hide
  button.dispatchEvent({ type: 'focusout' });
  t.mock.timers.tick(2000);
  assert.equal(host.dataset.revealed, 'false');
});

test('trailing pointermove reveals badge on stop in rect [M1]', (t) => {
  const { badge, host, doc } = withCapturedBadge(t);
  const video = createMockVideo({ paused: false });

  badge.show(video);
  t.mock.timers.tick(2000);
  assert.equal(host.dataset.revealed, 'false');

  // Leading move outside video rect consumes throttle window
  doc.dispatchEvent({
    type: 'pointermove',
    pointerType: 'mouse',
    clientX: 10,
    clientY: 10,
  });
  assert.equal(host.dataset.revealed, 'false');

  // Second move inside video rect 20ms later hits throttle -> trailing timer
  t.mock.timers.tick(20);
  doc.dispatchEvent({
    type: 'pointermove',
    pointerType: 'mouse',
    clientX: 300,
    clientY: 300,
  });
  assert.equal(host.dataset.revealed, 'false');

  // Cursor stops; 80ms later trailing timer fires and reveals badge
  t.mock.timers.tick(80);
  assert.equal(host.dataset.revealed, 'true');
  assert.equal(host.style.getPropertyValue('opacity'), '1');
});

test('conceal resets isPointerOnBadge after scroll-out [M2]', (t) => {
  const { badge, host, button } = withCapturedBadge(t);
  const video = createMockVideo({ paused: false });

  badge.show(video);
  t.mock.timers.tick(0);

  button.dispatchEvent({ type: 'pointerenter' });
  // Simulate video scrolling out of view while pointer was over badge
  const prevBox = video.getBoundingClientRect;
  video.getBoundingClientRect = () => ({
    left: 100,
    right: 900,
    top: -500,
    bottom: -100,
    width: 800,
    height: 400,
  });
  badge.refresh();
  t.mock.timers.tick(0);
  assert.equal(host.dataset.revealed, 'false');

  // Video scrolls back in; since isPointerOnBadge was reset, idle hide works
  video.getBoundingClientRect = prevBox;
  badge.show(video);
  t.mock.timers.tick(0);
  assert.equal(host.dataset.revealed, 'true');
  t.mock.timers.tick(2000);
  assert.equal(host.dataset.revealed, 'false');
});

test('switching target via show(video2) unbinds old video listeners', (t) => {
  const { badge, host } = withCapturedBadge(t);
  const video1 = createMockVideo({ paused: false });
  const video2 = createMockVideo({ paused: true });

  badge.show(video1);
  t.mock.timers.tick(0);
  assert.equal(video1.listenerCount('play'), 1);
  assert.equal(video1.listenerCount('pause'), 1);

  badge.show(video2);
  t.mock.timers.tick(0);
  assert.equal(video1.listenerCount('play'), 0);
  assert.equal(video1.listenerCount('pause'), 0);
  assert.equal(video2.listenerCount('play'), 1);
  assert.equal(video2.listenerCount('pause'), 1);

  // Old video playing must not hide badge bound to paused video2
  video1.dispatchEvent({ type: 'play' });
  t.mock.timers.tick(3000);
  assert.equal(host.dataset.revealed, 'true');
});
