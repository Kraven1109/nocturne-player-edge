import { createOverlay } from './ui.js';
import { createShadowHost, el, pinStyle } from './shell.js';
import { cacheHost, setSiteLoop } from './page/bridge.js';
import { findFeedScroller, stepFeed, waitForNextVideo } from './video/feed.js';
import { lockPageFullscreen } from './fullscreenlock.js';
import playerCss from './player.css';

const STALL_GRACE_MS = 400;
// Long enough for a site to finish re-attaching its stream. A scrub past the
// buffer makes YouTube tear its stream down and build it again, which on a slow
// connection takes seconds — and the player used to back out from under the
// finger that was scrubbing. A few seconds of black is a far smaller price than
// being thrown out of the film.
const EMPTIED_GRACE_MS = 6000;
const NETWORK_EMPTY = 0;
const RECOVER_DELAY_MS = 250;
const MAX_REPINS = 240;
// Below this share of the screen, a player that has lost fullscreen is playing
// in the box the site gave it — an embedded player's frame — rather than over
// the whole page, where it would still want its full set of controls.
const COMPACT_SCREEN_SHARE = 0.6;
// Turning the phone can cost the stage its fullscreen — the browser re-laying
// the screen out, or a site that reached it before the lock did. Losing it
// this close to a turn is not the user backing out.
const TURN_GRACE_MS = 1500;
const MAX_STABILIZE_MS = 600;

const STAGE_STYLE = {
  position: 'fixed',
  inset: '0',
  width: '100%',
  height: '100%',
  margin: '0',
  padding: '0',
  border: '0',
  display: 'flex',
  'align-items': 'center',
  'justify-content': 'center',
  overflow: 'hidden',
  background: '#000',
  'z-index': '2147483646',
};

const STAGE_CSS =
  '[data-nocturne-player]:fullscreen,' +
  '[data-nocturne-player]:-webkit-full-screen{' +
  'position:fixed!important;inset:0!important;' +
  'width:100%!important;height:100%!important;' +
  'max-width:none!important;max-height:none!important;' +
  'margin:0!important;padding:0!important;background:#000!important;}' +
  '[data-nocturne-player]::backdrop{background:#000!important;}' +
  'html:has([data-nocturne-player]),' +
  'body:has([data-nocturne-player]){' +
  'background:#000!important;color-scheme:dark!important;}';

// Hints Chromium/Edge Android's TopUiThemeColorProvider to tint any top bar
// strip pure #000000 while open, without mutating layout viewport metadata
// or overwriting an SPA update made during the session.
export const applyBlackThemeColor = (doc = document) => {
  const nodes = Array.from(
    doc.querySelectorAll?.('meta[name="theme-color" i]') ?? [],
  );
  const snapshots = nodes.map((node) => ({
    node,
    hadContent: node.hasAttribute('content'),
    content: node.getAttribute('content'),
  }));
  for (const { node } of snapshots) {
    node.setAttribute('content', '#000000');
  }

  let created = null;
  if (snapshots.length === 0 && doc.head) {
    created = doc.createElement('meta');
    created.setAttribute('name', 'theme-color');
    created.setAttribute('content', '#000000');
    created.setAttribute('data-nocturne-theme', '');
    doc.head.prepend(created);
  }

  return () => {
    if (created?.isConnected) created.remove();
    created = null;
    for (const snap of snapshots) {
      if (!snap.node.isConnected) continue;
      if (snap.node.getAttribute('content') !== '#000000') continue;
      if (snap.hadContent) snap.node.setAttribute('content', snap.content);
      else snap.node.removeAttribute('content');
    }
  };
};

// A site's own player keeps rewriting the video's inline style — YouTube sets
// a pixel width, height and offset on every layout pass — which is what used to
// leave the picture stuck against the left edge or stretched across the screen
// after coming back from another app. Position and offsets are pinned here too,
// not only the size, and re-pinned whenever the site writes over them.
const VIDEO_STYLE = {
  position: 'relative',
  left: '0',
  top: '0',
  right: 'auto',
  bottom: 'auto',
  float: 'none',
  width: '100%',
  height: '100%',
  'max-width': 'none',
  'max-height': 'none',
  'min-width': '0',
  'min-height': '0',
  margin: '0',
  padding: '0',
  border: '0',
  display: 'block',
  'object-fit': 'contain',
  'object-position': '50% 50%',
  background: '#000',
  'transform-origin': 'center center',
};

// Layout keys are pinned from VIDEO_STYLE; transform and filter are written by
// visuals and checked against visuals.getExpectedStyle() in pin() so pinching
// never triggers a self-repin loop.
const VIDEO_STYLE_KEYS = Object.keys(VIDEO_STYLE);

const STAGE_BUBBLE_EVENTS = [
  'touchstart',
  'touchmove',
  'touchend',
  'touchcancel',
  'pointerdown',
  'pointermove',
  'pointerup',
  'pointercancel',
];

const stopStageBubble = (event) => {
  event.stopPropagation();
};

export const captureVideoState = (video) => ({
  cssText: video.style.cssText,
  hasControlsAttribute: video.hasAttribute('controls'),
  isLooped: Boolean(video.loop),
  playbackRate: video.playbackRate,
  volume: video.volume,
  isMuted: video.muted,
  parent: video.parentNode,
  nextSibling: video.nextSibling,
});

export const commitCapturedVolume = (state, volume, isMuted) => {
  state.volume = volume;
  state.isMuted = Boolean(isMuted);
};

export const restoreVideoState = (video, state) => {
  video.style.cssText = state.cssText;
  if (state.hasControlsAttribute) video.setAttribute('controls', '');
  else video.removeAttribute('controls');
  video.loop = Boolean(state.isLooped);
  video.playbackRate = state.playbackRate;
  video.volume = state.volume;
  video.muted = state.isMuted;
};

const auditRestore = (video, state) => {
  const isSameParent = video.parentNode === state.parent;
  const isSameSibling = video.nextSibling === state.nextSibling;
  if (isSameParent && isSameSibling) return true;
  console.warn('Nocturne: video was not restored to its original position', {
    isSameParent,
    isSameSibling,
  });
  return false;
};

// The style is compared against what the browser serialised, never against
// what we asked for: setting `left: 0` reads back as `0px`, so comparing with
// the input would find a difference every time and re-pin on the strength of
// its own mutation record — a loop that recalculates style until the phone
// crawls.
const readStyle = (video) => {
  const seen = {};
  for (const name of VIDEO_STYLE_KEYS) {
    seen[name] = video.style.getPropertyValue(name);
  }
  return seen;
};

const isSameStyle = (first, second) => {
  if (first === null) return false;
  return VIDEO_STYLE_KEYS.every((name) => first[name] === second[name]);
};

const isVisualStyleIntact = (video, overlay) => {
  if (!overlay) return true;
  const { transform, filter } = overlay.getExpectedStyle();
  return (
    video.style.getPropertyValue('transform') === transform &&
    video.style.getPropertyValue('filter') === filter
  );
};

// Request immersive fullscreen on Chromium/Edge Android while keeping default
// Gecko fullscreen options on non-Chromium engines.
export const requestFullscreen = async (
  element,
  doc = document,
  isChromium = 'chrome' in globalThis,
) => {
  if (!doc.fullscreenEnabled) return false;
  if (!isChromium) {
    try {
      await element.requestFullscreen();
      return true;
    } catch (error) {
      console.warn('Nocturne: fullscreen refused', error);
      return false;
    }
  }
  try {
    await element.requestFullscreen({ navigationUI: 'hide' });
    return true;
  } catch (error) {
    if (error instanceof TypeError) {
      try {
        await element.requestFullscreen();
        return true;
      } catch (fallbackError) {
        console.warn('Nocturne: fullscreen refused', fallbackError);
        return false;
      }
    }
    console.warn('Nocturne: fullscreen refused', error);
    return false;
  }
};

// Losing fullscreen is how the user leaves the player, and it is also how
// Android announces that it is taking the video into a floating window. The two
// look identical at the moment they happen and only differ a beat later, when
// an app that has gone into the background is no longer the focused one.
const isBackgrounded = () => document.hidden || !document.hasFocus();

export const readOrientationAxis = (win = window) => {
  const type = win.screen?.orientation?.type;
  if (type) return type.split('-')[0];
  return win.innerWidth > win.innerHeight ? 'landscape' : 'portrait';
};

export const readOrientationState = (win = window) => {
  const type = win.screen?.orientation?.type;
  const angle = win.screen?.orientation?.angle ?? win.orientation ?? 0;
  if (type) return `${type}:${angle}`;
  return `${readOrientationAxis(win)}:${angle}`;
};

const isSmallerThanScreen = () => {
  const screenArea = window.screen.width * window.screen.height;
  if (screenArea === 0) return false;
  const viewArea = window.innerWidth * window.innerHeight;
  return viewArea < screenArea * COMPACT_SCREEN_SHARE;
};

// Everything a part of the player hooks into the page is undone together. The
// stage keeps one scope for as long as the player is open; each video it shows
// gets a scope of its own, which goes when a feed moves on to the next one.
const createScope = () => {
  const undos = [];
  const timers = new Set();

  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    undos.push(() => target.removeEventListener(type, handler, options));
  };

  const later = (handler, delay) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      handler();
    }, delay);
    timers.add(timer);
    return timer;
  };

  const cancel = (timer) => {
    clearTimeout(timer);
    timers.delete(timer);
  };

  const dispose = () => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    for (const undo of undos) undo();
    undos.length = 0;
  };

  return { listen, later, cancel, dispose };
};

// Gecko keeps a media element playing across a re-parent, but a site shim
// that reloads it leaves us holding an empty player. A quality switch empties
// the element too, so the verdict waits until the dust settles.
const watchForTeardown = (video, scope, onTornDown) => {
  let pending = null;

  // Any sign of life cancels the verdict. An element that is loading again is
  // an element the site is still using, whatever its readyState says at the
  // moment we happen to look.
  const revive = () => {
    if (pending === null) return;
    scope.cancel(pending);
    pending = null;
  };

  const LIFE_SIGNS = [
    'loadstart',
    'loadedmetadata',
    'progress',
    'seeked',
    'canplay',
    'playing',
  ];

  for (const name of LIFE_SIGNS) {
    scope.listen(video, name, revive);
  }

  scope.listen(video, 'emptied', () => {
    revive();
    pending = scope.later(() => {
      pending = null;
      const hasSource = video.currentSrc !== '' || video.srcObject !== null;
      // networkState is the honest one: NETWORK_EMPTY means the element has
      // no source at all, where a seek in progress reads as loading.
      const isEmpty = video.networkState === NETWORK_EMPTY;
      if (hasSource || video.readyState > 0 || !isEmpty) return;
      console.warn('Nocturne: the video was torn down, backing out');
      onTornDown();
    }, EMPTIED_GRACE_MS);
  });
};

// The screen is left to follow the phone. Locking it to landscape turned an
// upright TikTok or Reels video on its side the moment the player opened, and
// a film shot wide is one turn of the wrist away, which Android offers even
// with auto-rotate switched off.
export const createSession = (firstVideo, { onExit, settings, onPersist }) => {
  const stage = document.createElement('div');
  const ui = createShadowHost(playerCss);
  const scope = createScope();

  const layers = {
    warm: el('div', { class: 'layer warm' }),
    dim: el('div', { class: 'layer dim' }),
  };
  const loader = el('div', { class: 'feed-loader', hidden: '' });

  let isActive = false;
  let isStepping = false;
  let shown = null;
  let lastVideo = firstVideo;
  let relayoutFrame = 0;
  let stabilizeFrame = 0;
  let stabilizeStartAt = 0;
  let stabilizeLastSize = null;
  let stabilizeMatches = 0;
  let unlockPageFullscreen = () => {};
  let restoreThemeColor = () => {};
  let lastTurnAt = -Infinity;
  let heldOrientation = readOrientationState();

  const isStageFullscreen = () =>
    document.fullscreenElement === stage ||
    document.fullscreenElement === ui.host;

  const readScreen = () => {
    const isFullscreen = isStageFullscreen();
    return {
      isFullscreen,
      isCompact: !isFullscreen && isSmallerThanScreen(),
    };
  };

  const isTurning = () =>
    performance.now() - lastTurnAt < TURN_GRACE_MS ||
    readOrientationState() !== heldOrientation;

  const relayout = () => {
    relayoutFrame = 0;
    if (shown) shown.relayout();
  };

  const scheduleRelayout = () => {
    if (relayoutFrame !== 0) return;
    relayoutFrame = requestAnimationFrame(relayout);
  };

  let stabilizeInitialSize = null;

  const stopStabilize = () => {
    if (stabilizeFrame !== 0) cancelAnimationFrame(stabilizeFrame);
    stabilizeFrame = 0;
    stabilizeInitialSize = null;
    stabilizeLastSize = null;
    stabilizeMatches = 0;
  };

  const stageSize = () => {
    const rect = stage.getBoundingClientRect();
    return {
      key: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
      nonZero: rect.width > 0 && rect.height > 0,
    };
  };

  const stepStabilize = () => {
    stabilizeFrame = 0;
    if (!isActive) return;
    relayout();
    const { key: sizeKey, nonZero } = stageSize();
    const hasChanged =
      stabilizeInitialSize !== null && sizeKey !== stabilizeInitialSize;
    if (nonZero && hasChanged && sizeKey === stabilizeLastSize) {
      stabilizeMatches += 1;
    } else {
      stabilizeLastSize = sizeKey;
      stabilizeMatches = 0;
    }
    const elapsed = performance.now() - stabilizeStartAt;
    if (stabilizeMatches >= 3 || elapsed >= MAX_STABILIZE_MS) {
      stopStabilize();
      return;
    }
    stabilizeFrame = requestAnimationFrame(stepStabilize);
  };

  const startStabilizeRelayout = () => {
    stopStabilize();
    if (!isActive) return;
    stabilizeInitialSize = stageSize().key;
    stabilizeStartAt = performance.now();
    stabilizeFrame = requestAnimationFrame(stepStabilize);
  };

  // Late-bound: showing a video needs the way out and the way to the next
  // video, and both of those need to be able to show one.
  const actions = {
    exit: () => {},
    step: () => {},
    fullscreen: () => {},
    rotate: () => {},
  };

  // Takes one video out of the page, puts it on the stage with the controls
  // over it, and returns what is needed to hand it back exactly as it was.
  const show = (video, { shouldPlay, isChromeShown }) => {
    const state = captureVideoState(video);
    cacheHost(video);
    const anchor = document.createComment('nocturne-player');
    const own = createScope();

    let styleGuard = null;
    let pinnedStyle = null;
    let repinCount = 0;
    let overlay = null;

    // Re-pinning is bounded: a site that fights back with !important of its
    // own would otherwise trade writes with us for as long as the film lasts.
    // After the budget runs out the guard steps aside and the picture is
    // re-fitted on the ordinary relayout events instead.
    const pin = () => {
      if (
        isSameStyle(pinnedStyle, readStyle(video)) &&
        isVisualStyleIntact(video, overlay)
      ) {
        return;
      }

      repinCount += 1;
      if (repinCount > MAX_REPINS) {
        if (styleGuard) styleGuard.disconnect();
        styleGuard = null;
        console.warn(
          'Nocturne: the site keeps rewriting the video, leaving it',
        );
        return;
      }

      pinStyle(video, VIDEO_STYLE);
      if (overlay) overlay.repin();
      pinnedStyle = readStyle(video);
    };

    video.replaceWith(anchor);
    video.removeAttribute('controls');
    pin();

    // The site is free to keep laying its player out; it just does not get to
    // move the picture we are showing.
    styleGuard = new MutationObserver(pin);
    styleGuard.observe(video, {
      attributes: true,
      attributeFilter: ['style', 'width', 'height'],
    });

    stage.prepend(video);
    watchForTeardown(video, own, () => actions.exit());
    own.listen(video, 'loadedmetadata', scheduleRelayout);
    own.listen(video, 'resize', scheduleRelayout);

    overlay = createOverlay({
      video,
      stage,
      shadow: ui.shadow,
      layers,
      onExit: () => actions.exit(),
      settings,
      onPersist,
      onVolumeCommit: (volume, isMuted) =>
        commitCapturedVolume(state, volume, isMuted),
      onFeedStep: (direction) => actions.step(direction),
      onFullscreen: () => actions.fullscreen(),
      onRotate: () => actions.rotate(),
      isChromeShown,
    });
    overlay.setScreen(readScreen());

    own.later(() => {
      if (shouldPlay && video.paused) video.play().catch(() => {});
    }, STALL_GRACE_MS);

    const release = () => {
      own.dispose();
      if (styleGuard) styleGuard.disconnect();
      styleGuard = null;
      overlay.destroy();
      restoreVideoState(video, state);
      setSiteLoop(video, state.isLooped);
      if (anchor.isConnected) anchor.replaceWith(video);
      else video.remove();
      auditRestore(video, state);
    };

    lastVideo = video;
    return {
      video,
      release,
      notify: (text) => overlay.notify(text),
      rotateQuarter: () => overlay.rotateQuarter(),
      resetRotation: () => overlay.resetRotation(),
      showControls: () => overlay.showControls(),
      relayout: () => {
        pin();
        overlay.setScreen(readScreen());
        overlay.relayout();
      },
    };
  };

  const exit = () => {
    if (!isActive) return;
    isActive = false;

    if (relayoutFrame !== 0) cancelAnimationFrame(relayoutFrame);
    relayoutFrame = 0;
    stopStabilize();
    scope.dispose();
    unlockPageFullscreen();
    restoreThemeColor();
    restoreThemeColor = () => {};

    try {
      window.screen.orientation?.unlock?.();
    } catch {
      // Orientation was never locked or unlock is unsupported.
    }

    if (isStageFullscreen()) {
      document.exitFullscreen().catch(() => {});
    }

    if (shown) shown.release();
    shown = null;
    stage.remove();
    onExit(lastVideo);
  };

  // The video goes back into the page before the feed is moved: the site has
  // to find it where it left it, or it cannot pause it, recycle it, or tell
  // which one is next. The stage stays in fullscreen the whole time, so moving
  // on never needs a fresh gesture from the user to take the screen again.
  const step = async (direction) => {
    if (isStepping || shown === null) return;
    isStepping = true;

    const previous = shown.video;
    const previousSource = previous.currentSrc;
    shown.release();
    shown = null;
    loader.hidden = false;

    stepFeed(findFeedScroller(previous), direction);
    const next = await waitForNextVideo(previous, previousSource);

    loader.hidden = true;
    isStepping = false;
    if (!isActive) return;

    const target = next ?? (previous.isConnected ? previous : null);
    if (target === null) {
      exit();
      return;
    }
    // A swipe is a request for the next video, not for the controls: it comes
    // up the way the feed shows it, with nothing drawn over the picture.
    shown = show(target, { shouldPlay: true, isChromeShown: false });
    if (next === null) shown.notify('No more videos this way');
    scheduleRelayout();
  };

  actions.exit = exit;
  actions.step = step;
  actions.fullscreen = () => {
    requestFullscreen(stage).then(startStabilizeRelayout);
  };
  actions.rotate = async () => {
    const canLock =
      isStageFullscreen() &&
      typeof window.screen.orientation?.lock === 'function';
    if (canLock) {
      const current = readOrientationAxis();
      const next = current === 'landscape' ? 'portrait' : 'landscape';
      lastTurnAt = performance.now();
      try {
        await window.screen.orientation.lock(next);
        heldOrientation = readOrientationState();
        if (shown) {
          shown.resetRotation();
          shown.notify(next === 'landscape' ? 'Landscape' : 'Portrait');
        }
        startStabilizeRelayout();
        return;
      } catch {
        // Desktop browsers or restricted frames reject orientation.lock.
      }
    }
    if (!shown) return;
    const degrees = shown.rotateQuarter();
    shown.notify(degrees === 0 ? 'Rotation reset' : `Rotated ${degrees}°`);
  };

  const openStage = () => {
    restoreThemeColor = applyBlackThemeColor();
    stage.dataset.nocturnePlayer = '';
    pinStyle(stage, STAGE_STYLE);
    const stageStyle = document.createElement('style');
    stageStyle.dataset.nocturneStageStyle = '';
    stageStyle.textContent = STAGE_CSS;
    stage.append(stageStyle, ui.host);
    for (const name of STAGE_BUBBLE_EVENTS) {
      const options = name.startsWith('touch') ? { passive: true } : undefined;
      scope.listen(stage, name, stopStageBubble, options);
    }
    ui.shadow.append(layers.warm, layers.dim, loader);
    document.body.append(stage);
  };

  const restoreFullscreen = () => {
    if (isStageFullscreen()) return;
    // Gecko may refuse this without a fresh gesture. The stage covers the
    // viewport on its own, so the player stays usable either way.
    requestFullscreen(stage).then(scheduleRelayout);
  };

  const watchForReturn = () => {
    const noteTurn = () => {
      lastTurnAt = performance.now();
      const nextState = readOrientationState();
      if (nextState !== heldOrientation) {
        heldOrientation = nextState;
        if (shown) shown.resetRotation();
      }
      startStabilizeRelayout();
    };

    // A turn keeps the player open, out of fullscreen, with its controls up:
    // the fullscreen button is then one tap away. Gecko will not hand the
    // screen back without a tap, so the player cannot take it back itself.
    scope.listen(document, 'fullscreenchange', () => {
      scheduleRelayout();
      if (isStageFullscreen()) {
        heldOrientation = readOrientationState();
        return;
      }
      scope.later(() => {
        if (!isActive) return;
        if (isBackgrounded()) return;
        if (isTurning()) {
          heldOrientation = readOrientationState();
          if (shown) shown.showControls();
          return;
        }
        exit();
      }, RECOVER_DELAY_MS);
    });

    // Coming back from a floating window or from another app: re-take the
    // screen and re-fit the picture to whatever shape it is now.
    scope.listen(document, 'visibilitychange', () => {
      if (document.hidden) return;
      scope.later(() => {
        if (!isActive) return;
        restoreFullscreen();
        scheduleRelayout();
      }, RECOVER_DELAY_MS);
    });

    scope.listen(window, 'resize', scheduleRelayout);
    if (window.visualViewport) {
      scope.listen(window.visualViewport, 'resize', scheduleRelayout);
    }
    scope.listen(window, 'orientationchange', noteTurn);
    if (window.screen.orientation) {
      scope.listen(window.screen.orientation, 'change', noteTurn);
    }
  };

  const enter = async () => {
    if (isActive) return false;
    isActive = true;

    unlockPageFullscreen = lockPageFullscreen();
    openStage();
    // The picture first: a film that is playing opens with nothing drawn over
    // it, and a tap brings the controls up. One that is paused shows them, or
    // the screen would be a still frame with no hint of what to do next.
    shown = show(firstVideo, {
      shouldPlay: !firstVideo.paused,
      isChromeShown: firstVideo.paused,
    });
    watchForReturn();

    // The button that opens the player is drawn as a fullscreen icon, so it
    // takes the screen, every time.
    await requestFullscreen(stage);
    scheduleRelayout();
    return true;
  };

  return {
    enter,
    exit,
    stage,
    shadow: ui.shadow,
    layers,
    isActive: () => isActive,
  };
};
