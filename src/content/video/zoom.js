export const MIN_SCALE = 1;
export const SNAP_TOLERANCE = 0.04;
export const MAX_FREE_ZOOM = 4;

const SNAP_MIN_THRESHOLD = 1.05;
const SNAP_COVER_TOLERANCE = 0.1;

// With object-fit: contain the picture is letterboxed; this is the factor that
// makes it fill the stage instead, which is what crops the black bars away.
export const computeCoverScale = (
  videoWidth,
  videoHeight,
  stageWidth,
  stageHeight,
) => {
  if (videoWidth <= 0 || videoHeight <= 0) return 1;
  if (stageWidth <= 0 || stageHeight <= 0) return 1;
  const videoAspect = videoWidth / videoHeight;
  const stageAspect = stageWidth / stageHeight;
  const ratio =
    videoAspect > stageAspect
      ? videoAspect / stageAspect
      : stageAspect / videoAspect;
  return Number.isFinite(ratio) ? ratio : 1;
};

export const computeMaxScale = (coverScale) =>
  Math.max(MIN_SCALE, coverScale, MAX_FREE_ZOOM);

// Zooming stops at the supplied limit: callers pass either coverScale (crop) or
// computeMaxScale(coverScale) (free zoom + pan).
export const clampScale = (scale, maxScale) =>
  Math.min(Math.max(MIN_SCALE, maxScale), Math.max(MIN_SCALE, scale));

export const snapScale = (scale, targets) => {
  for (const target of targets) {
    if (Math.abs(scale - target) <= SNAP_TOLERANCE * target) return target;
  }
  return scale;
};

// Free-zoom release policy: snap close to 1x (recenter) or cover (fill), but
// keep any deliberate free zoom level between or above cover intact.
export const snapPinchScale = (
  scale,
  coverScale,
  maxScale = computeMaxScale(coverScale),
) => {
  const clamped = clampScale(scale, maxScale);
  if (clamped <= SNAP_MIN_THRESHOLD) return MIN_SCALE;
  if (Math.abs(clamped - coverScale) <= SNAP_COVER_TOLERANCE) {
    return clampScale(coverScale, maxScale);
  }
  return clamped;
};

// Returns screen-space AABB dimensions (already swapped at 90/270deg) plus the
// pre-zoom base scale needed to fit a quarter-turned frame inside the stage.
export const computeDrawSize = (
  videoWidth,
  videoHeight,
  stageWidth,
  stageHeight,
  rotationDeg = 0,
) => {
  if (
    videoWidth <= 0 ||
    videoHeight <= 0 ||
    stageWidth <= 0 ||
    stageHeight <= 0
  ) {
    return { drawWidth: stageWidth, drawHeight: stageHeight, baseScale: 1 };
  }
  const fit = Math.min(stageWidth / videoWidth, stageHeight / videoHeight);
  const pw = videoWidth * fit;
  const ph = videoHeight * fit;
  const isQuarterTurn = Math.abs(rotationDeg) % 180 === 90;
  if (!isQuarterTurn) {
    return { drawWidth: pw, drawHeight: ph, baseScale: 1 };
  }
  const baseScale = Math.min(stageWidth / ph, stageHeight / pw);
  return {
    drawWidth: ph * baseScale,
    drawHeight: pw * baseScale,
    baseScale,
  };
};

// Anchors the content point under the pinch midpoint while adding midpoint
// drift so zooming toward a corner keeps that detail under the user's fingers.
export const computeFocalPan = (
  panX,
  panY,
  prevScale,
  nextScale,
  focalX,
  focalY,
  dx = 0,
  dy = 0,
) => {
  const ratio = prevScale > 0 ? nextScale / prevScale : 1;
  return {
    x: focalX - (focalX - panX) * ratio + dx,
    y: focalY - (focalY - panY) * ratio + dy,
  };
};

// Panning may never reveal a black margin where rendered pixels end, so the
// offset is bounded by how much the scaled picture overflows the stage.
export const clampPan = (
  x,
  y,
  scale,
  stageWidth,
  stageHeight,
  drawWidth = stageWidth,
  drawHeight = stageHeight,
) => {
  const maxX = Math.max(0, (drawWidth * scale - stageWidth) / 2);
  const maxY = Math.max(0, (drawHeight * scale - stageHeight) / 2);
  return {
    x: Math.min(maxX, Math.max(-maxX, x)),
    y: Math.min(maxY, Math.max(-maxY, y)),
  };
};
