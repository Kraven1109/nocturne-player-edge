import { chapterAt } from '../video/chapters.js';
import { formatClock, formatRemaining } from '../../lib/time.js';
import { el } from '../shell.js';

const SEEK_SETTLE_MS = 60;
const SEEK_STALL_MS = 400;
const SEEK_EPSILON_S = 0.5;
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

export const createSeekBar = (video, seek, { onInteract = () => {} } = {}) => {
  const elapsed = el('span', { class: 'time', text: '0:00' });
  const remaining = el('span', { class: 'time', text: '--:--' });
  const fill = el('div', { class: 'seek-fill' });
  const marks = el('div', { class: 'seek-marks' });
  const zones = el('div', { class: 'seek-zones' });
  const track = el('div', { class: 'seek-track' }, [fill, zones, marks]);

  const previewChapter = el('span', { class: 'seek-preview-chapter' });
  const headTime = el('span', { class: 'seek-time', text: '0:00' });
  const previewBox = el('div', { class: 'seek-preview' }, [
    previewChapter,
    headTime,
  ]);

  const area = el('div', { class: 'seek-area' }, [track, previewBox]);
  const chapterLabel = el('div', { class: 'chapter' });
  const root = el('div', { class: 'seekbar' }, [
    chapterLabel,
    el('div', { class: 'seek-row' }, [elapsed, area, remaining]),
  ]);

  let isScrubbing = false;
  let isPointerScrub = false;
  let wasPlayingBeforeScrub = false;
  let isPreviewSeeking = false;
  let pendingPreviewTime = null;
  let previewTimer = null;
  let lastDispatchedTime = null;
  let activePointerId = null;
  let lastPointerX = 0;
  let scrubTime = 0;
  let chapters = [];
  let arePlaced = false;
  let spans = [];

  const duration = () => (Number.isFinite(video.duration) ? video.duration : 0);

  const clearPreviewTimer = () => {
    if (previewTimer === null) return;
    clearTimeout(previewTimer);
    previewTimer = null;
  };

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

  let dispatchPreviewSeek = () => {};

  const flushPendingPreview = () => {
    previewTimer = null;
    if (!isScrubbing || pendingPreviewTime === null) return;
    const next = pendingPreviewTime;
    pendingPreviewTime = null;
    dispatchPreviewSeek(next);
  };

  const onSeekStall = () => {
    previewTimer = null;
    isPreviewSeeking = false;
    if (isScrubbing && pendingPreviewTime !== null) {
      flushPendingPreview();
    }
  };

  dispatchPreviewSeek = (time) => {
    clearPreviewTimer();
    isPreviewSeeking = true;
    lastDispatchedTime = time;
    previewTimer = setTimeout(onSeekStall, SEEK_STALL_MS);
    seek(time, false);
  };

  const requestPreviewSeek = (time) => {
    if (isPreviewSeeking || previewTimer !== null) {
      pendingPreviewTime = time;
      return;
    }
    dispatchPreviewSeek(time);
  };

  const onPreviewSeeked = () => {
    if (!isScrubbing || !isPreviewSeeking) return;
    if (
      lastDispatchedTime !== null &&
      Math.abs(video.currentTime - lastDispatchedTime) >= SEEK_EPSILON_S
    ) {
      return;
    }
    clearPreviewTimer();
    isPreviewSeeking = false;
    if (pendingPreviewTime !== null) {
      previewTimer = setTimeout(flushPendingPreview, SEEK_SETTLE_MS);
    }
  };

  const beginScrub = (initialTime) => {
    clearPreviewTimer();
    isPreviewSeeking = false;
    pendingPreviewTime = null;
    lastDispatchedTime = null;
    if (!isScrubbing) wasPlayingBeforeScrub = !video.paused;
    scrubTime = initialTime;
    isScrubbing = true;
    root.classList.add('is-scrubbing');
    if (wasPlayingBeforeScrub && typeof video.pause === 'function') {
      video.pause();
    }
  };

  const start = () => {
    elapsed.textContent = formatClock(video.currentTime);
    beginScrub(video.currentTime);
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
    requestPreviewSeek(scrubTime);
  };

  const end = () => {
    if (!isScrubbing) return;
    clearPreviewTimer();
    isPreviewSeeking = false;
    pendingPreviewTime = null;
    lastDispatchedTime = null;
    isScrubbing = false;
    isPointerScrub = false;
    activePointerId = null;
    root.classList.remove('is-scrubbing');
    if (duration() > 0) seek(scrubTime, true);
    if (wasPlayingBeforeScrub) {
      wasPlayingBeforeScrub = false;
      if (typeof video.play === 'function') {
        const result = video.play();
        if (result && typeof result.catch === 'function') {
          result.catch(() => {});
        }
      }
    }
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
    elapsed.textContent = formatClock(video.currentTime);
    beginScrub(ratio * total);
    paint(scrubTime);
    requestPreviewSeek(scrubTime);
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
      requestPreviewSeek(scrubTime);
      return;
    }

    if (isScrubbing) return;

    const ratio = ratioFromPointer(event.clientX, rect);
    const hoverTime = ratio * total;
    root.classList.add('is-hovering');
    updatePreview(hoverTime, ratio);
  };

  const handleTrackUp = (event) => {
    if (!isPointerScrub || event.pointerId !== activePointerId) return;
    event.stopPropagation();
    onInteract();
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
  video.addEventListener('seeked', onPreviewSeeked);
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
      if (isScrubbing) end();
      clearPreviewTimer();
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
      video.removeEventListener('seeked', onPreviewSeeked);
    },
  };
};
