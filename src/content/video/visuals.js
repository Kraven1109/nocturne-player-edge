import {
  PINCH_RESET_THRESHOLD,
  clampPan,
  clampScale,
  computeCoverScale,
  computeDrawSize,
  computeFocalPan,
  computeMaxScale,
} from './zoom.js';

const TRANSFORM_TRANSITION = 'transform 260ms cubic-bezier(0.32, 0.72, 0, 1)';
const FILTER_TRANSITION = 'filter 320ms ease';
const PAN_EPSILON_PX = 0.5;

// Every filter function is always present and always in the same order, so the
// browser can interpolate between two states smoothly.
const buildFilter = ({ saturate, contrast, brightness }) => {
  // Untouched settings mean no filter at all, so the film is passed through
  // exactly as the site encoded it.
  const isNeutral = saturate === 1 && contrast === 1 && brightness === 1;
  if (isNeutral) return 'none';
  const tone = `contrast(${contrast}) brightness(${brightness})`;
  return `saturate(${saturate}) ${tone}`;
};

// What the zoom means, rather than the number it currently works out to. The
// stage changes size whenever the phone rotates, the system takes the video
// into a floating window, or the app comes back from the background — and the
// same intent has to survive all three.
const FIT = 'fit';
const FILL = 'fill';
const FREE = 'free';

export const createVisuals = (
  video,
  stage,
  { onScaleChange = () => {} } = {},
) => {
  const colour = { saturate: 1, contrast: 1, brightness: 1 };
  const view = { scale: 1, x: 0, y: 0 };

  let intent = FIT;
  let rotation = 0;
  let isPinching = false;
  let isDragging = false;
  let pendingRelayout = false;
  let lastTransform = 'none';
  let lastFilter = 'none';
  let pinchOrigin = null;

  const stageSize = () => {
    const rect = stage.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  };

  const currentDraw = (size = stageSize()) =>
    computeDrawSize(
      video.videoWidth,
      video.videoHeight,
      size.width,
      size.height,
      rotation,
    );

  const coverScale = (size = stageSize()) => {
    const isQuarter = rotation % 180 !== 0;
    const vw = isQuarter ? video.videoHeight : video.videoWidth;
    const vh = isQuarter ? video.videoWidth : video.videoHeight;
    return computeCoverScale(vw, vh, size.width, size.height);
  };

  const apply = () => {
    const filter = buildFilter(colour);
    const { baseScale } = currentDraw();
    const totalScale = baseScale * view.scale;
    const isNeutral =
      view.scale === 1 && view.x === 0 && view.y === 0 && rotation === 0;
    const offset = `translate(${view.x}px, ${view.y}px)`;
    const rot = rotation === 0 ? '' : ` rotate(${rotation}deg)`;
    const transform = isNeutral
      ? 'none'
      : `${offset}${rot} scale(${totalScale})`;
    const transition =
      isPinching || isDragging
        ? FILTER_TRANSITION
        : `${FILTER_TRANSITION}, ${TRANSFORM_TRANSITION}`;

    const targetStyle = stage.style ?? video.style;
    targetStyle.setProperty('--nocturne-filter', filter);
    targetStyle.setProperty('--nocturne-transform', transform);
    targetStyle.setProperty('--nocturne-transition', transition);
    lastFilter = targetStyle.getPropertyValue?.('--nocturne-filter') || filter;
    lastTransform =
      targetStyle.getPropertyValue?.('--nocturne-transform') || transform;
  };

  const place = (scale) => {
    const size = stageSize();
    const cover = coverScale(size);
    const maxScale = computeMaxScale(cover);
    view.scale = clampScale(scale, maxScale);
    if (view.scale === 1) {
      view.x = 0;
      view.y = 0;
    }
    const draw = currentDraw(size);
    const pan = clampPan(
      view.x,
      view.y,
      view.scale,
      size.width,
      size.height,
      draw.drawWidth,
      draw.drawHeight,
    );
    view.x = pan.x;
    view.y = pan.y;
    apply();
    onScaleChange(view.scale);
    return view.scale;
  };

  const remember = (scale) => {
    const cover = coverScale();
    if (scale === 1) {
      intent = FIT;
    } else if (Math.abs(scale - cover) < 1e-6 && cover > 1) {
      intent = FILL;
    } else {
      intent = FREE;
    }
  };

  const setScale = (scale) => {
    const applied = place(scale);
    remember(applied);
    return applied;
  };

  // Re-derives the scale the intent asks for at the current stage size. This is
  // what stops the picture from being left at yesterday's crop — blown up and
  // stretched — after the window has changed shape underneath it.
  const relayout = () => {
    const size = stageSize();
    if (video.videoWidth === 0 || size.width <= 0 || size.height <= 0) {
      apply();
      return false;
    }
    if (isPinching || isDragging) {
      pendingRelayout = true;
      return false;
    }
    pendingRelayout = false;
    const cover = coverScale(size);
    if (intent === FIT) {
      place(1);
    } else if (intent === FILL) {
      place(cover);
    } else {
      place(view.scale);
      remember(view.scale);
    }
    return true;
  };

  const flushPendingRelayout = () => {
    if (!pendingRelayout || isPinching || isDragging) return false;
    pendingRelayout = false;
    return relayout();
  };

  const canPan = () => {
    const size = stageSize();
    if (size.width <= 0 || size.height <= 0) return false;
    const draw = currentDraw(size);
    const overflowX = (draw.drawWidth * view.scale - size.width) / 2;
    const overflowY = (draw.drawHeight * view.scale - size.height) / 2;
    return overflowX > PAN_EPSILON_PX || overflowY > PAN_EPSILON_PX;
  };

  const panOffset = (dx, dy) => {
    view.x += dx;
    view.y += dy;
    place(view.scale);
  };

  apply();

  return {
    relayout,
    // The site rewrites the video's inline style and the guard puts the
    // position and the size back — but the crop lives in `transform`, which
    // the guard knows nothing about, so it has to be written again here or the
    // picture drops back into its letterbox the moment the site touches it.
    repin: apply,
    getExpectedStyle: () => ({
      transform: lastTransform,
      filter: lastFilter,
    }),
    setColour: (patch) => {
      Object.assign(colour, patch);
      apply();
    },
    getColour: () => ({ ...colour }),
    beginPinch: ({ focalX = null, focalY = null } = {}) => {
      isPinching = true;
      pinchOrigin = {
        scale: view.scale,
        x: view.x,
        y: view.y,
        focalX: Number.isFinite(focalX) ? focalX : null,
        focalY: Number.isFinite(focalY) ? focalY : null,
      };
      apply();
      return view.scale;
    },
    pinchTo: (scale, { focalX = 0, focalY = 0, dx = 0, dy = 0 } = {}) => {
      const cover = coverScale();
      const maxScale = computeMaxScale(cover);
      const nextScale = clampScale(scale, maxScale);
      const anchor = pinchOrigin;
      if (anchor) {
        if (anchor.focalX === null) {
          anchor.focalX = focalX - dx;
          anchor.focalY = focalY - dy;
        }
        const focal = computeFocalPan(
          anchor.x,
          anchor.y,
          anchor.scale,
          nextScale,
          anchor.focalX,
          anchor.focalY,
          focalX - anchor.focalX,
          focalY - anchor.focalY,
        );
        view.x = focal.x;
        view.y = focal.y;
      } else {
        const focal = computeFocalPan(
          view.x,
          view.y,
          view.scale,
          nextScale,
          focalX,
          focalY,
          dx,
          dy,
        );
        view.x = focal.x;
        view.y = focal.y;
      }
      return setScale(nextScale);
    },
    endPinch: () => {
      if (!isPinching) {
        flushPendingRelayout();
        return view.scale;
      }
      isPinching = false;
      pinchOrigin = null;
      const target = view.scale <= PINCH_RESET_THRESHOLD ? 1 : view.scale;
      setScale(target);
      flushPendingRelayout();
      return view.scale;
    },
    canPan,
    beginPan: () => {
      isDragging = true;
      apply();
    },
    panBy: panOffset,
    stepPan: panOffset,
    endPan: () => {
      if (!isDragging) {
        flushPendingRelayout();
        return;
      }
      isDragging = false;
      apply();
      flushPendingRelayout();
    },
    resetZoom: () => {
      isPinching = false;
      isDragging = false;
      pinchOrigin = null;
      view.x = 0;
      view.y = 0;
      const applied = setScale(1);
      flushPendingRelayout();
      return applied;
    },
    rotateQuarter: () => {
      rotation = (rotation + 90) % 360;
      view.x = 0;
      view.y = 0;
      relayout();
      return rotation;
    },
    resetRotation: () => {
      if (rotation === 0) return;
      rotation = 0;
      view.x = 0;
      view.y = 0;
      relayout();
    },
    getRotation: () => rotation,
    reset: () => {
      rotation = 0;
      view.x = 0;
      view.y = 0;
      return setScale(1);
    },
    getScale: () => view.scale,
  };
};
