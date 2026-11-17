import { hitTest, isDragZone, isHoldZone, ZONE } from './zones.js';
import { isVerticalMove, readSwipe } from './swipe.js';

const HOLD_DELAY_MS = 350;
// How long a lone tap on a side waits for a second one before it is taken to
// mean "show the controls". Acting on it at once turned a double-tap that was
// not quite quick enough into the controls popping up instead of a seek.
const MULTI_TAP_WINDOW_MS = 320;
// Once a side is seeking, a tap on it keeps seeking for a little longer than
// the double-tap window: tapping on to go further is a slower rhythm than the
// two taps that started it.
const SEEK_RUN_MS = 700;
const MOVE_TOLERANCE_PX = 12;

const MODE = {
  IDLE: 'idle',
  PENDING: 'pending',
  DRAG: 'drag',
  HOLD: 'hold',
  PINCH: 'pinch',
  SWIPE: 'swipe',
  ABANDONED: 'abandoned',
};

const distanceBetween = (first, second) => {
  const dx = first.x - second.x;
  const dy = first.y - second.y;
  return Math.hypot(dx, dy);
};

const midpointOf = (first, second) => ({
  x: (first.x + second.x) / 2,
  y: (first.y + second.y) / 2,
  width: first.width,
  height: first.height,
});

// `canSwipe` is asked at the moment a finger starts to travel, not once up
// front: the phone may have been turned, or the feed moved on to a film of a
// different shape, since the player opened.
export const createRecognizer = (
  surface,
  handlers,
  {
    canSwipe = () => false,
    canVerticalDrag = () => false,
    canPan = () => false,
  } = {},
) => {
  const pointers = new Map();

  let mode = MODE.IDLE;
  let anchor = null;
  let dragAxis = 'horizontal';
  let holdTimer = null;
  let tapTimer = null;
  let tapCount = 0;
  let tapZone = ZONE.DEAD;
  let pinchStartDistance = 0;
  let pinchLastMid = { x: 0, y: 0 };
  let pinchIds = null;
  let isEnabled = true;

  const emit = (name, detail) => {
    const handler = handlers[name];
    if (handler) handler(detail);
  };

  const localPoint = (event) => {
    const rect = surface.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };
  };

  const clearHoldTimer = () => {
    if (holdTimer === null) return;
    clearTimeout(holdTimer);
    holdTimer = null;
  };

  const flushTaps = () => {
    tapTimer = null;
    // A run of seeks in a side box has already been sent tap by tap.
    const isSeekRun = isHoldZone(tapZone);
    if (tapCount === 1) emit('tap', { zone: tapZone });
    else if (!isSeekRun) emit('multiTap', { zone: tapZone, count: tapCount });
    tapCount = 0;
  };

  // The neutral middle has no double-tap, so a tap there acts at once: the
  // controls come up under the finger and a quick second tap lands on pause.
  // Only a tap that strays there in the middle of a side run waits, and counts
  // towards that run — a second tap rarely lands exactly where the first did.
  // Tapping the other side mid-run starts a run of its own.
  const registerTap = (zone, point) => {
    const isSideRun = tapCount > 0 && isHoldZone(tapZone);
    if (zone === ZONE.DEAD && !isSideRun) {
      emit('tap', { zone });
      return;
    }
    if (tapCount === 0 || (zone !== ZONE.DEAD && zone !== tapZone)) {
      tapCount = 0;
      tapZone = zone;
    }
    tapCount += 1;
    if (tapTimer !== null) clearTimeout(tapTimer);

    // In the side boxes every tap from the second on is a seek, sent the moment
    // the finger lifts. Waiting the window out first put a quarter of a second
    // between the tap and the jump, on top of whatever the seek itself takes.
    if (tapCount >= 2 && isHoldZone(tapZone)) {
      emit('multiTap', {
        zone: tapZone,
        count: tapCount,
        x: point.x,
        y: point.y,
      });
      tapTimer = setTimeout(flushTaps, SEEK_RUN_MS);
      return;
    }
    tapTimer = setTimeout(flushTaps, MULTI_TAP_WINDOW_MS);
  };

  const capturePointer = (pointerId) => {
    try {
      surface.setPointerCapture(pointerId);
    } catch {
      // Synthetic events or detached elements cannot capture pointers.
    }
  };

  const startPinch = () => {
    clearHoldTimer();
    const prevMode = mode;
    const prevAxis = dragAxis;
    const ids = Array.from(pointers.keys());
    pinchIds = [ids[0], ids[1]];
    const first = pointers.get(pinchIds[0]);
    const second = pointers.get(pinchIds[1]);
    const mid = midpointOf(first, second);
    pinchStartDistance = Math.max(12, distanceBetween(first, second));
    pinchLastMid = mid;
    mode = MODE.PINCH;
    dragAxis = 'horizontal';
    if (prevMode === MODE.DRAG) {
      emit('dragEnd', { zone: anchor.zone, axis: prevAxis });
    }
    if (prevMode === MODE.HOLD) emit('holdEnd', { zone: anchor.zone });
    emit('pinchStart', {
      x: mid.x,
      y: mid.y,
      width: mid.width,
      height: mid.height,
    });
  };

  const shouldReenterPinch = () => {
    if (pointers.size < 2) return false;
    const points = Array.from(pointers.values());
    return distanceBetween(points[0], points[1]) >= MOVE_TOLERANCE_PX;
  };

  const finishActiveGesture = () => {
    clearHoldTimer();
    const prevMode = mode;
    const prevAxis = dragAxis;
    pinchIds = null;
    mode = MODE.IDLE;
    dragAxis = 'horizontal';
    if (prevMode === MODE.DRAG) {
      emit('dragEnd', { zone: anchor.zone, axis: prevAxis });
    } else if (prevMode === MODE.HOLD) {
      emit('holdEnd', { zone: anchor.zone });
    } else if (prevMode === MODE.PINCH) {
      emit('pinchEnd', {});
    }
  };

  const resetPointers = () => {
    if (pointers.size === 0 && mode === MODE.IDLE) return;
    pointers.clear();
    finishActiveGesture();
    emit('gestureReset', {});
  };

  const handleDown = (event) => {
    if (!isEnabled) return;
    if (
      event.pointerType === 'touch' &&
      event.isPrimary === true &&
      pointers.size > 0 &&
      !pointers.has(event.pointerId)
    ) {
      resetPointers();
    }
    capturePointer(event.pointerId);
    const point = localPoint(event);
    pointers.set(event.pointerId, point);
    if (mode === MODE.PINCH) return;
    if (mode === MODE.ABANDONED) {
      if (shouldReenterPinch()) startPinch();
      return;
    }

    if (pointers.size === 2) {
      startPinch();
      return;
    }
    if (pointers.size > 2) return;

    anchor = {
      x: point.x,
      y: point.y,
      lastX: point.x,
      lastY: point.y,
      zone: hitTest(point.x, point.y, point.width, point.height),
    };
    mode = MODE.PENDING;
    holdTimer = setTimeout(() => {
      holdTimer = null;
      if (mode !== MODE.PENDING || !isHoldZone(anchor.zone)) return;
      mode = MODE.HOLD;
      emit('holdStart', { zone: anchor.zone });
    }, HOLD_DELAY_MS);
  };

  const readPinchPair = () => {
    if (pinchIds) {
      const first = pointers.get(pinchIds[0]);
      const second = pointers.get(pinchIds[1]);
      if (first && second) return [first, second];
    }
    const points = Array.from(pointers.values());
    return points.length >= 2 ? [points[0], points[1]] : null;
  };

  const handlePinchMove = () => {
    const pair = readPinchPair();
    if (!pair) return;
    const spread = distanceBetween(pair[0], pair[1]);
    const mid = midpointOf(pair[0], pair[1]);
    const dx = mid.x - pinchLastMid.x;
    const dy = mid.y - pinchLastMid.y;
    pinchLastMid = mid;
    if (pinchStartDistance === 0) return;
    emit('pinchMove', {
      scale: spread / pinchStartDistance,
      dx,
      dy,
      x: mid.x,
      y: mid.y,
      width: mid.width,
      height: mid.height,
    });
  };

  const handleMove = (event) => {
    if (!pointers.has(event.pointerId)) return;
    const point = localPoint(event);
    pointers.set(event.pointerId, point);

    if (mode === MODE.PINCH) {
      handlePinchMove();
      return;
    }
    if (mode === MODE.ABANDONED) {
      if (shouldReenterPinch()) startPinch();
      return;
    }
    const isSettled = mode === MODE.HOLD || mode === MODE.SWIPE;
    if (isSettled) return;

    if (mode === MODE.PENDING) {
      const dx = point.x - anchor.x;
      const dy = point.y - anchor.y;
      if (Math.hypot(dx, dy) < MOVE_TOLERANCE_PX) return;
      clearHoldTimer();
      if (canPan()) {
        dragAxis = 'pan';
      } else {
        // Checked before the zones: a flick up is the same gesture wherever on
        // the picture it starts, the seek band and the side boxes included.
        if (isVerticalMove(dx, dy) && canSwipe()) {
          mode = MODE.SWIPE;
          return;
        }
        const isVerticalSideDrag =
          isVerticalMove(dx, dy) &&
          isHoldZone(anchor.zone) &&
          canVerticalDrag();
        if (!isVerticalSideDrag && !isDragZone(anchor.zone)) {
          mode = MODE.ABANDONED;
          return;
        }
        dragAxis = isVerticalSideDrag ? 'vertical' : 'horizontal';
      }
      mode = MODE.DRAG;
      emit('dragStart', {
        zone: anchor.zone,
        axis: dragAxis,
        x: anchor.x,
        y: anchor.y,
      });
    }

    if (mode !== MODE.DRAG) return;
    emit('dragMove', {
      zone: anchor.zone,
      axis: dragAxis,
      dx: point.x - anchor.lastX,
      dy: point.y - anchor.lastY,
      totalDx: point.x - anchor.x,
      totalDy: point.y - anchor.y,
      x: point.x,
      y: point.y,
      width: point.width,
      height: point.height,
    });
    anchor.lastX = point.x;
    anchor.lastY = point.y;
  };

  const finishSwipe = (event) => {
    const point = localPoint(event);
    const direction = readSwipe(point.y - anchor.y, point.height);
    if (direction !== null) emit('swipe', { direction });
  };

  const handleUp = (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);

    if (mode === MODE.PINCH) {
      if (pointers.size >= 2) return;
      pinchIds = null;
      mode = pointers.size === 0 ? MODE.IDLE : MODE.ABANDONED;
      emit('pinchEnd', {});
      return;
    }
    if (pointers.size > 0) return;

    clearHoldTimer();
    const prevMode = mode;
    const prevAxis = dragAxis;
    mode = MODE.IDLE;
    dragAxis = 'horizontal';
    if (prevMode === MODE.DRAG) {
      emit('dragEnd', { zone: anchor.zone, axis: prevAxis });
    } else if (prevMode === MODE.HOLD) {
      emit('holdEnd', { zone: anchor.zone });
    } else if (prevMode === MODE.SWIPE) {
      finishSwipe(event);
    } else if (prevMode === MODE.PENDING) {
      registerTap(anchor.zone, anchor);
    }
  };

  const handleCancel = (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    clearHoldTimer();
    const prevMode = mode;
    const prevAxis = dragAxis;
    if (pointers.size === 0) {
      mode = MODE.IDLE;
      dragAxis = 'horizontal';
    }
    if (prevMode === MODE.DRAG) {
      emit('dragEnd', { zone: anchor.zone, axis: prevAxis });
    }
    if (prevMode === MODE.HOLD) emit('holdEnd', { zone: anchor.zone });
    if (prevMode === MODE.PINCH && pointers.size < 2) {
      pinchIds = null;
      mode = pointers.size === 0 ? MODE.IDLE : MODE.ABANDONED;
      emit('pinchEnd', {});
    }
  };

  // Without this, a long press raises the system context menu and Gecko
  // cancels the pointer, which used to drop hold-to-2x after a second or two.
  const blockContextMenu = (event) => event.preventDefault();

  surface.addEventListener('contextmenu', blockContextMenu);
  surface.addEventListener('pointerdown', handleDown);
  surface.addEventListener('pointermove', handleMove);
  surface.addEventListener('pointerup', handleUp);
  surface.addEventListener('pointercancel', handleCancel);
  surface.addEventListener('lostpointercapture', handleCancel);

  const adoptPointers = (entries) => {
    if (!isEnabled) return;
    for (const [id, raw] of entries) {
      pointers.set(id, localPoint(raw));
    }
    if (mode !== MODE.PINCH && pointers.size >= 2) {
      startPinch();
    }
  };

  const eventHandlers = {
    pointerdown: handleDown,
    pointermove: handleMove,
    pointerup: handleUp,
    pointercancel: handleCancel,
    lostpointercapture: handleCancel,
  };

  return {
    setEnabled: (value) => {
      isEnabled = value;
    },
    adoptPointers,
    resetPointers,
    getPointerCount: () => pointers.size,
    handlePointerEvent: (type, event) => eventHandlers[type]?.(event),
    destroy: () => {
      clearHoldTimer();
      if (tapTimer !== null) clearTimeout(tapTimer);
      surface.removeEventListener('contextmenu', blockContextMenu);
      surface.removeEventListener('pointerdown', handleDown);
      surface.removeEventListener('pointermove', handleMove);
      surface.removeEventListener('pointerup', handleUp);
      surface.removeEventListener('pointercancel', handleCancel);
      surface.removeEventListener('lostpointercapture', handleCancel);
    },
  };
};
