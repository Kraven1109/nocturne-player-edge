export const DRAG_HEIGHT_FRACTION = 0.75;
export const MIN_DIM_LEVEL = 0.1;
export const MAX_DIM_LEVEL = 0.99;
export const AUTO_HYSTERESIS_PX = 24;
export const AUTO_FP_TOLERANCE_PX = 0.5;
export const AUTO_FALLBACK_RAW = 0.05;
export const DIM_AUTO_LABEL = 'Dim: AUTO ☀';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const computeDimStep = ({
  dragBase,
  totalDy,
  height,
  enteredAutoFromBottom = false,
}) => {
  const span = height > 0 ? height * DRAG_HEIGHT_FRACTION : 1;
  const raw = dragBase - totalDy / span;

  if (raw >= 1) {
    return {
      level: null,
      opacity: 0,
      label: DIM_AUTO_LABEL,
      enteredAutoFromBottom: false,
    };
  }

  if (enteredAutoFromBottom) {
    const exitThreshold = MIN_DIM_LEVEL + AUTO_HYSTERESIS_PX / span;
    if (raw < exitThreshold) {
      return {
        level: null,
        opacity: 0,
        label: DIM_AUTO_LABEL,
        enteredAutoFromBottom: true,
      };
    }
  } else {
    const extraPx = (MIN_DIM_LEVEL - raw) * span;
    const isPastBottomThreshold =
      raw < MIN_DIM_LEVEL &&
      extraPx >= AUTO_HYSTERESIS_PX - AUTO_FP_TOLERANCE_PX;
    if (isPastBottomThreshold || raw < AUTO_FALLBACK_RAW) {
      return {
        level: null,
        opacity: 0,
        label: DIM_AUTO_LABEL,
        enteredAutoFromBottom: true,
      };
    }
  }

  const level = clamp(raw, MIN_DIM_LEVEL, MAX_DIM_LEVEL);
  const opacity = Math.round((1 - level) * 10000) / 10000;
  const percent = clamp(Math.round(level * 100), 10, 99);
  return {
    level,
    opacity,
    label: `Dim: ${percent}%`,
    enteredAutoFromBottom: false,
  };
};

export const computeVolumeStep = ({ dragBase, totalDy, height }) => {
  const span = height > 0 ? height * DRAG_HEIGHT_FRACTION : 1;
  const raw = dragBase - totalDy / span;
  const clamped = clamp(raw, 0, 1);
  const percent = Math.round(clamped * 100);
  if (percent === 0) {
    return { volume: 0, isMuted: true, label: 'Muted' };
  }
  return {
    volume: clamped,
    isMuted: false,
    label: `Volume: ${percent}%`,
  };
};

export const createDimDrag = ({ dimLayer, showToast, toastMs }) => {
  let level = null;
  let dragBase = null;
  let enteredAutoFromBottom = false;
  let lastLabel = DIM_AUTO_LABEL;

  return {
    start: () => {
      if (dragBase !== null) return;
      dragBase = level ?? 1;
      enteredAutoFromBottom = false;
      lastLabel =
        level === null ? DIM_AUTO_LABEL : `Dim: ${Math.round(level * 100)}%`;
      dimLayer.classList.add('is-dragging');
    },
    move: ({ totalDy = 0, height = 0 }) => {
      if (dragBase === null) return;
      const step = computeDimStep({
        dragBase,
        totalDy,
        height,
        enteredAutoFromBottom,
      });
      level = step.level;
      enteredAutoFromBottom = step.enteredAutoFromBottom;
      lastLabel = step.label;
      dimLayer.style.opacity = String(step.opacity);
      showToast(step.label, null);
    },
    end: () => {
      if (dragBase === null) return;
      dragBase = null;
      enteredAutoFromBottom = false;
      dimLayer.classList.remove('is-dragging');
      showToast(lastLabel, toastMs);
    },
    reset: () => {
      level = null;
      dragBase = null;
      enteredAutoFromBottom = false;
      lastLabel = DIM_AUTO_LABEL;
      dimLayer.classList.remove('is-dragging');
      dimLayer.style.opacity = '0';
    },
  };
};

export const createVolumeDrag = ({ video, onCommit, showToast, toastMs }) => {
  let dragBase = null;
  let lastLabel = '';

  const formatVolume = (volume, isMuted) =>
    isMuted || Math.round(volume * 100) === 0
      ? 'Muted'
      : `Volume: ${Math.round(volume * 100)}%`;

  return {
    start: () => {
      if (dragBase !== null) return;
      dragBase = video.muted ? 0 : clamp(video.volume, 0, 1);
      lastLabel = formatVolume(dragBase, dragBase === 0);
    },
    move: ({ totalDy = 0, height = 0 }) => {
      if (dragBase === null) return;
      const step = computeVolumeStep({ dragBase, totalDy, height });
      video.volume = step.volume;
      video.muted = step.isMuted;
      lastLabel = step.label;
      showToast(step.label, null);
    },
    end: () => {
      if (dragBase === null) return;
      dragBase = null;
      const volume = clamp(video.volume, 0, 1);
      const isMuted = Boolean(video.muted);
      onCommit(volume, isMuted);
      showToast(lastLabel || formatVolume(volume, isMuted), toastMs);
    },
  };
};
