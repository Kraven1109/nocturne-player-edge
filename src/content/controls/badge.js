import { createShadowHost, el, pinStyle } from '../shell.js';
import badgeCss from './badge.css';

const SIZE_PX = 44;
const INSET_PX = 12;
const MIN_VISIBLE_RATIO = 0.35;
const IDLE_HIDE_MS = 2000;
const MOVE_THROTTLE_MS = 100;

// Fullscreen arrows rather than a logo: what the button does is make this
// video fill the screen, and that is what a viewer is looking for.
const buildButton = () =>
  el('button', { class: 'badge', type: 'button', title: 'Fullscreen' }, [
    el('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, [
      el('path', { d: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5' }),
    ]),
  ]);

const isPointInRect = (x, y, rect) =>
  x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

export const createBadge = () => {
  const shell = createShadowHost(badgeCss, {
    width: `${SIZE_PX}px`,
    height: `${SIZE_PX}px`,
    'pointer-events': 'auto',
    transition: 'opacity 200ms ease',
  });

  const button = buildButton();
  shell.shadow.append(button);

  let target = null;
  let frame = 0;
  let isMounted = false;
  let isRevealed = true;
  let isPointerOnBadge = false;
  let isFocused = false;
  let idleTimer = null;
  let moveTrailingTimer = null;
  let lastMoveCheckAt = -Infinity;
  let lastPointer = null;

  const clearIdleTimer = () => {
    if (idleTimer === null) return;
    clearTimeout(idleTimer);
    idleTimer = null;
  };

  const clearMoveTrailingTimer = () => {
    if (moveTrailingTimer === null) return;
    clearTimeout(moveTrailingTimer);
    moveTrailingTimer = null;
  };

  const isMostlyVisible = (rect) => {
    const visibleTop = Math.max(rect.top, 0);
    const visibleBottom = Math.min(rect.bottom, window.innerHeight);
    const visible = Math.max(0, visibleBottom - visibleTop);
    return visible / rect.height >= MIN_VISIBLE_RATIO;
  };

  const conceal = () => {
    isPointerOnBadge = false;
    shell.host.dataset.revealed = 'false';
    pinStyle(shell.host, { opacity: '0', 'pointer-events': 'none' });
  };

  // Halfway up the right edge, which is the one part of a video that no player
  // puts a control on: the bottom corner sat on top of the site's own buttons
  // and swallowed taps meant for them.
  const placement = (rect) => {
    const left = rect.right - SIZE_PX - INSET_PX;
    const top = rect.top + rect.height / 2 - SIZE_PX / 2;
    const maxTop = window.innerHeight - SIZE_PX - INSET_PX;
    return {
      left: `${Math.max(INSET_PX, left)}px`,
      top: `${Math.min(maxTop, Math.max(INSET_PX, top))}px`,
    };
  };

  // Teardown is the watcher's job: when the video goes away it reports a new
  // primary and calls hide(). Here we only stop drawing.
  const reposition = () => {
    frame = 0;
    if (!target?.isConnected || !isRevealed) {
      conceal();
      return;
    }
    const rect = target.getBoundingClientRect();
    if (rect.width === 0 || !isMostlyVisible(rect)) {
      conceal();
      return;
    }
    shell.host.dataset.revealed = 'true';
    pinStyle(shell.host, {
      opacity: '1',
      'pointer-events': 'auto',
      ...placement(rect),
    });
  };

  const scheduleReposition = () => {
    if (frame !== 0) return;
    frame = requestAnimationFrame(reposition);
  };

  const reveal = () => {
    isRevealed = true;
    shell.host.dataset.revealed = 'true';
    if (isMounted) reposition();
  };

  const scheduleIdleHide = () => {
    clearIdleTimer();
    if (!target || target.paused) return;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (!target || target.paused || isPointerOnBadge || isFocused) return;
      isRevealed = false;
      conceal();
    }, IDLE_HIDE_MS);
  };

  const checkPointer = () => {
    if (!isMounted || !target || target.paused || lastPointer === null) return;
    const rect = target.getBoundingClientRect();
    if (rect.width === 0) return;
    if (isPointInRect(lastPointer.x, lastPointer.y, rect)) {
      reveal();
      scheduleIdleHide();
    } else if (!isPointerOnBadge && !isFocused && isRevealed) {
      clearIdleTimer();
      isRevealed = false;
      conceal();
    }
  };

  const handleDocumentPointerMove = (event) => {
    if (
      !isMounted ||
      !target ||
      target.paused ||
      event.pointerType !== 'mouse'
    ) {
      return;
    }
    lastPointer = { x: event.clientX, y: event.clientY };
    const wait = MOVE_THROTTLE_MS - (performance.now() - lastMoveCheckAt);
    if (wait <= 0) {
      clearMoveTrailingTimer();
      lastMoveCheckAt = performance.now();
      checkPointer();
    } else if (moveTrailingTimer === null) {
      moveTrailingTimer = setTimeout(() => {
        moveTrailingTimer = null;
        lastMoveCheckAt = performance.now();
        checkPointer();
      }, wait);
    }
  };

  const handleDocumentPointerDown = (event) => {
    if (!isMounted || !target || target.paused) return;
    const rect = target.getBoundingClientRect();
    if (rect.width === 0) return;
    if (isPointInRect(event.clientX, event.clientY, rect)) {
      reveal();
      scheduleIdleHide();
    }
  };

  const handleTargetPause = () => {
    clearIdleTimer();
    reveal();
  };

  const handleTargetPlay = () => {
    scheduleIdleHide();
  };

  const handleBadgeEnter = () => {
    isPointerOnBadge = true;
    clearIdleTimer();
  };

  const handleBadgeLeave = () => {
    isPointerOnBadge = false;
    if (target && !target.paused && !isFocused) scheduleIdleHide();
  };

  const handleBadgeFocusIn = () => {
    isFocused = true;
    clearIdleTimer();
    reveal();
  };

  const handleBadgeFocusOut = () => {
    isFocused = false;
    if (target && !target.paused && !isPointerOnBadge) scheduleIdleHide();
  };

  const unbindTarget = () => {
    if (target === null) return;
    target.removeEventListener('pause', handleTargetPause);
    target.removeEventListener('play', handleTargetPlay);
    target = null;
  };

  const bindTarget = (video) => {
    if (target === video) return;
    unbindTarget();
    target = video;
    if (target !== null) {
      target.addEventListener('pause', handleTargetPause);
      target.addEventListener('play', handleTargetPlay);
    }
  };

  const mount = () => {
    if (!shell.host.isConnected) document.body.append(shell.host);
    if (isMounted) return;
    window.addEventListener('scroll', scheduleReposition, {
      passive: true,
      capture: true,
    });
    window.addEventListener('resize', scheduleReposition, { passive: true });
    document.addEventListener('pointermove', handleDocumentPointerMove, {
      passive: true,
      capture: true,
    });
    document.addEventListener('pointerdown', handleDocumentPointerDown, {
      passive: true,
      capture: true,
    });
    button.addEventListener('pointerenter', handleBadgeEnter);
    button.addEventListener('pointerleave', handleBadgeLeave);
    button.addEventListener('focusin', handleBadgeFocusIn);
    button.addEventListener('focusout', handleBadgeFocusOut);
    isMounted = true;
  };

  const show = (video) => {
    bindTarget(video);
    mount();
    isRevealed = true;
    shell.host.dataset.revealed = 'true';
    if (video.paused) clearIdleTimer();
    else scheduleIdleHide();
    scheduleReposition();
  };

  const hide = () => {
    unbindTarget();
    clearIdleTimer();
    clearMoveTrailingTimer();
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    isPointerOnBadge = false;
    isFocused = false;
    lastPointer = null;
    if (!isMounted) return;
    window.removeEventListener('scroll', scheduleReposition, true);
    window.removeEventListener('resize', scheduleReposition);
    document.removeEventListener(
      'pointermove',
      handleDocumentPointerMove,
      true,
    );
    document.removeEventListener(
      'pointerdown',
      handleDocumentPointerDown,
      true,
    );
    button.removeEventListener('pointerenter', handleBadgeEnter);
    button.removeEventListener('pointerleave', handleBadgeLeave);
    button.removeEventListener('focusin', handleBadgeFocusIn);
    button.removeEventListener('focusout', handleBadgeFocusOut);
    shell.host.remove();
    isMounted = false;
  };

  const api = { show, hide, refresh: scheduleReposition, onActivate: null };

  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (target && api.onActivate) api.onActivate(target);
  });

  return api;
};
