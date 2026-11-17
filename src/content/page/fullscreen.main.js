// Early monkeypatch in MAIN world at document_start so site scripts cannot
// cache unpatched references to requestFullscreen / exitFullscreen before the
// player opens. While `locked` is false, all calls pass straight through.

const LOCKED = [
  {
    owner: typeof Element !== 'undefined' ? Element.prototype : null,
    names: ['requestFullscreen', 'webkitRequestFullscreen'],
  },
  {
    owner: typeof Document !== 'undefined' ? Document.prototype : null,
    names: ['exitFullscreen', 'webkitExitFullscreen'],
  },
];

let isLocked = false;

// TEMPORARY diagnostic: tell the isolated world about every call, with the
// caller's stack. Remove with src/content/debuglog.js.
const reportCall = (name, thisArg, blocked) => {
  if (!isLocked) return;
  try {
    const stack = String(new Error().stack || '')
      .split('\n')
      .slice(2, 5)
      .map((line) => line.trim())
      .join(' | ');
    const who = thisArg && thisArg.tagName ? thisArg.tagName : 'document';
    document.dispatchEvent(
      new CustomEvent('nocturne:dbg', {
        detail: `${blocked ? 'BLOCKED' : 'PASS'} ${name} on ${who} @ ${stack}`,
      }),
    );
  } catch {
    // Diagnostics must never break the page.
  }
};

const wrapFullscreenMethod = (original, name) =>
  new Proxy(original, {
    apply(target, thisArg, args) {
      if (
        isLocked &&
        !(
          thisArg instanceof Element &&
          thisArg.hasAttribute('data-nocturne-player')
        )
      ) {
        reportCall(name, thisArg, true);
        return Promise.resolve();
      }
      reportCall(name, thisArg, false);
      return Reflect.apply(target, thisArg, args);
    },
  });

export const installFullscreenLock = () => {
  for (const { owner, names } of LOCKED) {
    if (!owner) continue;
    for (const name of names) {
      let original;
      try {
        original = owner[name];
      } catch {
        continue;
      }
      if (typeof original !== 'function') continue;
      try {
        Object.defineProperty(owner, name, {
          configurable: true,
          writable: true,
          value: wrapFullscreenMethod(original, name),
        });
      } catch {
        // Ignore if non-configurable in an unusual environment.
      }
    }
  }
};

export const setFullscreenLocked = (locked) => {
  isLocked = Boolean(locked);
  return isLocked;
};
