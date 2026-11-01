import { chapterAt } from '../video/chapters.js';
import { formatClock, formatRemaining } from '../../lib/time.js';
import { el } from '../shell.js';

const PREVIEW_INTERVAL_MS = 120;
const THUMB_WIDTH = 160;
const THUMB_HEIGHT = 90;
const BUCKET_STEP_SEC = 0.5;
const MAX_CACHED_FRAMES = 60;
const EDGE_CLAMP_MIN = 8;
const EDGE_CLAMP_MAX = 92;

// Pull the finger away from the bar and the same swipe covers less time, so a
// two-hour film can be landed on the exact scene.
const PRECISION_STEPS = [
  { withinPx: 40, factor: 1 },
  { withinPx: 100, factor: 0.5 },
  { withinPx: 180, factor: 0.25 },
  { withinPx: Infinity, factor: 0.1 },
];

const precisionFor = (distancePx) => {
  for (const step of PRECISION_STEPS) {
    if (distancePx <= step.withinPx) return step;
  }
  return PRECISION_STEPS[PRECISION_STEPS.length - 1];
};

export const clampRatio = (value) => {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
};

export const ratioFromPointer = (clientX, rect) => {
  if (!rect || !Number.isFinite(rect.width) || rect.width <= 0) return 0;
  return clampRatio((clientX - rect.left) / rect.width);
};

export const clampPreviewPercent = (ratio) => {
  const percent = clampRatio(ratio) * 100;
  return Math.min(EDGE_CLAMP_MAX, Math.max(EDGE_CLAMP_MIN, percent));
};

// Fits a frame inside the thumbnail box without stretching it.
export const fitThumb = (
  videoWidth,
  videoHeight,
  maxWidth = THUMB_WIDTH,
  maxHeight = THUMB_HEIGHT,
) => {
  if (
    !Number.isFinite(videoWidth) ||
    !Number.isFinite(videoHeight) ||
    videoWidth <= 0 ||
    videoHeight <= 0
  ) {
    return { width: maxWidth, height: maxHeight };
  }
  const scale = Math.min(maxWidth / videoWidth, maxHeight / videoHeight);
  return {
    width: Math.max(1, Math.round(videoWidth * scale)),
    height: Math.max(1, Math.round(videoHeight * scale)),
  };
};

const isDirectMediaUrl = (src) =>
  typeof src === 'string' &&
  src !== '' &&
  !src.startsWith('blob:') &&
  !src.startsWith('mediasource:');

const createThumbnailer = (video, thumbBox, thumbCanvas, thumbSprite) => {
  const ctx =
    typeof thumbCanvas.getContext === 'function'
      ? thumbCanvas.getContext('2d')
      : null;
  const cache = new Map();

  let lastSpriteAt = 0;
  let spriteShown = false;
  let previewVideo = null;
  let loadedSrc = '';
  let isSeekingPreview = false;
  let pendingBucket = null;
  let activeBucket = null;

  const sizeBox = (width, height) => {
    thumbBox.style.width = `${width}px`;
    thumbBox.style.height = `${height}px`;
  };

  const sizeCanvas = (width, height) => {
    if (thumbCanvas.width !== width) thumbCanvas.width = width;
    if (thumbCanvas.height !== height) thumbCanvas.height = height;
    sizeBox(width, height);
  };

  const setMode = (mode) => {
    thumbBox.classList.toggle('is-ready', mode !== 'none');
    thumbBox.classList.toggle('is-sprite', mode === 'sprite');
  };

  const cacheFrame = (bucket) => {
    if (!ctx) return;
    try {
      const data = ctx.getImageData(
        0,
        0,
        thumbCanvas.width,
        thumbCanvas.height,
      );
      if (cache.size >= MAX_CACHED_FRAMES) {
        const oldest = cache.keys().next().value;
        cache.delete(oldest);
      }
      cache.set(bucket, data);
    } catch {
      // Cross-origin media without CORS headers taints the canvas; ignore.
    }
  };

  const drawFromElement = (sourceEl) => {
    if (!ctx) return false;
    try {
      const { width, height } = fitThumb(
        sourceEl.videoWidth,
        sourceEl.videoHeight,
      );
      sizeCanvas(width, height);
      ctx.drawImage(sourceEl, 0, 0, width, height);
      return true;
    } catch {
      return false;
    }
  };

  const runNextPreviewSeek = () => {
    if (
      isSeekingPreview ||
      pendingBucket === null ||
      previewVideo === null ||
      previewVideo.readyState < 1
    ) {
      return;
    }
    const target = pendingBucket;
    pendingBucket = null;
    isSeekingPreview = true;
    try {
      previewVideo.currentTime = target;
    } catch {
      isSeekingPreview = false;
    }
  };

  const ensurePreviewVideo = () => {
    const src = video.currentSrc || '';
    if (!isDirectMediaUrl(src)) return null;
    if (previewVideo !== null && loadedSrc === src) return previewVideo;

    if (previewVideo !== null) {
      previewVideo.removeAttribute('src');
      previewVideo.load();
    }

    loadedSrc = src;
    cache.clear();
    isSeekingPreview = false;
    pendingBucket = null;

    const elVideo = document.createElement('video');
    elVideo.muted = true;
    elVideo.playsInline = true;
    elVideo.preload = 'auto';
    elVideo.src = src;

    elVideo.addEventListener('loadedmetadata', () => {
      runNextPreviewSeek();
    });

    elVideo.addEventListener('seeked', () => {
      const bucket =
        Math.round(elVideo.currentTime / BUCKET_STEP_SEC) * BUCKET_STEP_SEC;
      isSeekingPreview = false;
      if (drawFromElement(elVideo)) {
        cacheFrame(bucket);
        if (activeBucket === bucket) setMode('canvas');
      }
      runNextPreviewSeek();
    });

    previewVideo = elVideo;
    return previewVideo;
  };

  const tryYouTubeSprite = (ratio) => {
    if (typeof document === 'undefined') return false;
    const scope =
      video.closest('.html5-video-player') ??
      document.querySelector('#movie_player') ??
      document;
    const now = performance.now();
    if (now - lastSpriteAt < PREVIEW_INTERVAL_MS) return spriteShown;
    lastSpriteAt = now;
    const bar = scope.querySelector('.ytp-progress-bar');
    if (bar !== null) {
      const rect = bar.getBoundingClientRect();
      if (rect.width > 0) {
        bar.dispatchEvent(
          new MouseEvent('mousemove', {
            bubbles: true,
            cancelable: true,
            clientX: rect.left + clampRatio(ratio) * rect.width,
            clientY: rect.top + rect.height / 2,
          }),
        );
      }
    }
    const bg = scope.querySelector('.ytp-tooltip-bg');
    if (bg === null) return (spriteShown = false);
    const bgImage = bg.style.backgroundImage;
    if (!bgImage || bgImage === 'none') return (spriteShown = false);

    thumbSprite.style.backgroundImage = bgImage;
    thumbSprite.style.backgroundPosition = bg.style.backgroundPosition || '0 0';
    thumbSprite.style.backgroundSize = bg.style.backgroundSize || 'auto';
    if (bg.style.width) thumbSprite.style.width = bg.style.width;
    if (bg.style.height) thumbSprite.style.height = bg.style.height;
    sizeBox(
      parseFloat(bg.style.width) || THUMB_WIDTH,
      parseFloat(bg.style.height) || THUMB_HEIGHT,
    );
    setMode('sprite');
    spriteShown = true;
    return true;
  };

  const requestAt = (seconds, ratio) => {
    const bucket = Math.round(seconds / BUCKET_STEP_SEC) * BUCKET_STEP_SEC;
    activeBucket = bucket;

    if (cache.has(bucket) && ctx) {
      const cached = cache.get(bucket);
      sizeCanvas(cached.width, cached.height);
      ctx.putImageData(cached, 0, 0);
      setMode('canvas');
      return;
    }

    const helper = ensurePreviewVideo();
    if (helper !== null) {
      if (
        video.readyState >= 2 &&
        Math.abs(video.currentTime - seconds) <= BUCKET_STEP_SEC &&
        drawFromElement(video)
      ) {
        setMode('canvas');
      }
      pendingBucket = bucket;
      runNextPreviewSeek();
      return;
    }

    if (tryYouTubeSprite(ratio)) return;

    if (
      video.readyState >= 2 &&
      Math.abs(video.currentTime - seconds) <= BUCKET_STEP_SEC &&
      drawFromElement(video)
    ) {
      setMode('canvas');
      return;
    }

    setMode('none');
  };

  const destroy = () => {
    cache.clear();
    if (previewVideo !== null) {
      previewVideo.removeAttribute('src');
      previewVideo.load();
      previewVideo = null;
    }
  };

  return { requestAt, destroy };
};

export const createSeekBar = (video, seek, { onInteract = () => {} } = {}) => {
  const elapsed = el('span', { class: 'time', text: '0:00' });
  const remaining = el('span', { class: 'time', text: '--:--' });
  const fill = el('div', { class: 'seek-fill' });
  const marks = el('div', { class: 'seek-marks' });
  const zones = el('div', { class: 'seek-zones' });
  const track = el('div', { class: 'seek-track' }, [fill, zones, marks]);

  const thumbCanvas = el('canvas', {
    class: 'seek-thumb-canvas',
    width: String(THUMB_WIDTH),
    height: String(THUMB_HEIGHT),
  });
  const thumbSprite = el('div', { class: 'seek-thumb-sprite' });
  const thumbBox = el('div', { class: 'seek-thumb' }, [
    thumbCanvas,
    thumbSprite,
  ]);
  const previewChapter = el('span', { class: 'seek-preview-chapter' });
  const headTime = el('span', { class: 'seek-time', text: '0:00' });
  const previewBox = el('div', { class: 'seek-preview' }, [
    thumbBox,
    previewChapter,
    headTime,
  ]);

  const area = el('div', { class: 'seek-area' }, [track, previewBox]);
  const chapterLabel = el('div', { class: 'chapter' });
  const root = el('div', { class: 'seekbar' }, [
    chapterLabel,
    el('div', { class: 'seek-row' }, [elapsed, area, remaining]),
  ]);

  const thumbnailer = createThumbnailer(
    video,
    thumbBox,
    thumbCanvas,
    thumbSprite,
  );

  let isScrubbing = false;
  let isPointerScrub = false;
  let activePointerId = null;
  let lastPointerX = 0;
  let scrubTime = 0;
  let lastPreviewAt = 0;
  let chapters = [];
  let arePlaced = false;
  let spans = [];

  const duration = () => (Number.isFinite(video.duration) ? video.duration : 0);

  // The dividers can only be placed once the film has told us how long it is,
  // so placing them is retried from the paint that follows.
  const placeMarks = () => {
    const total = duration();
    if (arePlaced || chapters.length === 0 || total === 0) return;
    const dividers = chapters
      .filter((chapter) => chapter.start > 0 && chapter.start < total)
      .map((chapter) => {
        const mark = el('span', { class: 'seek-mark' });
        mark.style.left = `${(chapter.start / total) * 100}%`;
        return mark;
      });
    marks.replaceChildren(...dividers);
    arePlaced = true;
  };

  // A different length puts every divider somewhere else.
  const replaceMarks = () => {
    arePlaced = false;
    placeMarks();
  };

  // Stretches of the film painted onto the track — the opening, once it has
  // been recognised — redrawn whenever the length of the film is learned.
  const placeZones = () => {
    const total = duration();
    if (total === 0) return;
    const drawn = spans.map((span) => {
      const zone = el('span', { class: 'seek-zone' });
      zone.style.left = `${(span.start / total) * 100}%`;
      zone.style.width = `${((span.end - span.start) / total) * 100}%`;
      return zone;
    });
    zones.replaceChildren(...drawn);
  };

  const showChapter = (time) => {
    if (chapters.length === 0) return;
    const chapter = chapterAt(chapters, time);
    const title = chapter === null ? '' : chapter.title;
    if (chapterLabel.textContent === title) return;
    chapterLabel.textContent = title;
    chapterLabel.classList.toggle('is-visible', title !== '');
  };

  const updatePreview = (time, explicitRatio = null) => {
    const total = duration();
    let ratio = 0;
    if (explicitRatio !== null) ratio = clampRatio(explicitRatio);
    else if (total > 0) ratio = clampRatio(time / total);
    const clampedPct = clampPreviewPercent(ratio);
    area.style.setProperty('--preview', `${clampedPct}%`);
    headTime.textContent = formatClock(time);

    const chapter = chapters.length > 0 ? chapterAt(chapters, time) : null;
    const chapterText = chapter === null ? '' : chapter.title;
    previewChapter.textContent = chapterText;
    previewChapter.classList.toggle('is-visible', chapterText !== '');

    thumbnailer.requestAt(time, ratio);
  };

  // While scrubbing the left label holds the moment the drag started, so the
  // target time on the line is not simply repeated back to the user and they
  // can see where to return to.
  const paint = (time) => {
    const total = duration();
    placeMarks();
    showChapter(time);
    const ratio = total > 0 ? clampRatio(time / total) : 0;
    fill.style.transform = `scaleX(${ratio})`;
    area.style.setProperty('--progress', `${ratio * 100}%`);
    if (isScrubbing) updatePreview(time, ratio);
    else headTime.textContent = formatClock(time);
    remaining.textContent = formatRemaining(time, video.duration);
    if (!isScrubbing) elapsed.textContent = formatClock(time);
  };

  const sync = () => {
    if (isScrubbing) return;
    paint(video.currentTime);
  };

  const start = () => {
    scrubTime = video.currentTime;
    lastPreviewAt = 0;
    elapsed.textContent = formatClock(scrubTime);
    isScrubbing = true;
    root.classList.add('is-scrubbing');
    updatePreview(scrubTime);
  };

  // Measured rather than assumed: the bar sits a fifth of the way up the
  // screen, and where exactly that lands depends on the phone.
  const barCenter = (fallback) => {
    const rect = track.getBoundingClientRect();
    if (rect.height === 0) return fallback;
    return rect.top + rect.height / 2;
  };

  const move = ({ dx, y, width, height }) => {
    const total = duration();
    if (total === 0) return;

    const step = precisionFor(Math.abs(y - barCenter(height)));
    scrubTime += (dx / width) * total * step.factor;
    scrubTime = Math.min(total, Math.max(0, scrubTime));
    paint(scrubTime);

    const now = performance.now();
    if (now - lastPreviewAt < PREVIEW_INTERVAL_MS) return;
    lastPreviewAt = now;
    seek(scrubTime, false);
  };

  const end = () => {
    if (!isScrubbing) return;
    isScrubbing = false;
    root.classList.remove('is-scrubbing');
    if (duration() > 0) seek(scrubTime, true);
    paint(scrubTime);
  };

  const handleTrackDown = (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    event.stopPropagation();
    onInteract();

    const total = duration();
    if (total <= 0) return;

    if (typeof area.setPointerCapture === 'function') {
      try {
        area.setPointerCapture(event.pointerId);
      } catch {
        // Ignore if synthetic event has no active pointerId.
      }
    }

    const rect = track.getBoundingClientRect();
    const ratio = ratioFromPointer(event.clientX, rect);
    activePointerId = event.pointerId;
    lastPointerX = event.clientX;
    isPointerScrub = true;
    isScrubbing = true;
    lastPreviewAt = performance.now();
    elapsed.textContent = formatClock(video.currentTime);
    scrubTime = ratio * total;
    root.classList.add('is-scrubbing');
    paint(scrubTime);
    seek(scrubTime, false);
  };

  const handleTrackMove = (event) => {
    const total = duration();
    if (total <= 0) return;

    const rect = track.getBoundingClientRect();
    if (isPointerScrub && event.pointerId === activePointerId) {
      event.stopPropagation();
      onInteract();

      const verticalDistance = Math.abs(
        event.clientY - (rect.top + rect.height / 2),
      );
      const step = precisionFor(verticalDistance);
      if (step.factor === 1) {
        const ratio = ratioFromPointer(event.clientX, rect);
        scrubTime = ratio * total;
      } else if (rect.width > 0) {
        const dx = event.clientX - lastPointerX;
        scrubTime += (dx / rect.width) * total * step.factor;
        scrubTime = Math.min(total, Math.max(0, scrubTime));
      }
      lastPointerX = event.clientX;
      paint(scrubTime);

      const now = performance.now();
      if (now - lastPreviewAt >= PREVIEW_INTERVAL_MS) {
        lastPreviewAt = now;
        seek(scrubTime, false);
      }
      return;
    }

    const ratio = ratioFromPointer(event.clientX, rect);
    const hoverTime = ratio * total;
    root.classList.add('is-hovering');
    updatePreview(hoverTime, ratio);
  };

  const handleTrackUp = (event) => {
    if (!isPointerScrub || event.pointerId !== activePointerId) return;
    event.stopPropagation();
    onInteract();
    isPointerScrub = false;
    activePointerId = null;
    end();
  };

  const handleTrackLeave = () => {
    root.classList.remove('is-hovering');
  };

  area.addEventListener('pointerdown', handleTrackDown);
  area.addEventListener('pointermove', handleTrackMove);
  area.addEventListener('pointerup', handleTrackUp);
  area.addEventListener('pointercancel', handleTrackUp);
  area.addEventListener('pointerleave', handleTrackLeave);

  video.addEventListener('timeupdate', sync);
  video.addEventListener('durationchange', sync);
  video.addEventListener('durationchange', placeZones);
  video.addEventListener('durationchange', replaceMarks);
  video.addEventListener('seeked', sync);
  sync();

  return {
    root,
    start,
    move,
    end,
    setZones: (list) => {
      spans = list;
      placeZones();
    },
    setChapters: (list) => {
      chapters = list;
      arePlaced = false;
      // placeMarks and showChapter both return early on an empty list, which
      // would leave the previous film's dividers and title on screen.
      if (list.length === 0) {
        marks.replaceChildren();
        chapterLabel.textContent = '';
        chapterLabel.classList.remove('is-visible');
      }
      placeMarks();
      showChapter(video.currentTime);
    },
    destroy: () => {
      thumbnailer.destroy();
      area.removeEventListener('pointerdown', handleTrackDown);
      area.removeEventListener('pointermove', handleTrackMove);
      area.removeEventListener('pointerup', handleTrackUp);
      area.removeEventListener('pointercancel', handleTrackUp);
      area.removeEventListener('pointerleave', handleTrackLeave);
      video.removeEventListener('timeupdate', sync);
      video.removeEventListener('durationchange', sync);
      video.removeEventListener('durationchange', placeZones);
      video.removeEventListener('durationchange', replaceMarks);
      video.removeEventListener('seeked', sync);
    },
  };
};
