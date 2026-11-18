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

const wrapFullscreenMethod = (original) =>
  new Proxy(original, {
    apply(target, thisArg, args) {
      if (
        isLocked &&
        !(
          thisArg instanceof Element &&
          thisArg.hasAttribute('data-nocturne-player')
        )
      ) {
        return Promise.resolve();
      }
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
          value: wrapFullscreenMethod(original),
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
