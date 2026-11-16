import {
  captionsDisable,
  captionsProbe,
  captionsSelect,
} from '../page/bridge.js';

const PROBE_INTERVAL_MS = 1000;

// Players that paint their own captions instead of exposing a text track. The
// element the site draws into is still updated while the video sits on our
// stage, so its text is mirrored into the player's own cue layer.
const CONTAINER_SELECTORS = [
  '.ytp-caption-window-container',
  '.shaka-text-container',
  '.vjs-text-track-display',
  '.jw-captions',
  '.plyr__captions',
  '.pjscaptions',
];

// Tried in order; the first selector that matches something decides how the
// lines are split, so a nested wrapper cannot repeat the same words twice.
const LINE_SELECTORS = [
  '.ytp-caption-segment',
  '.caption-visual-line',
  '.vjs-text-track-cue',
  '.jw-text-track-cue',
  '.shaka-text-wrapper span',
];

const readLines = (container) => {
  for (const selector of LINE_SELECTORS) {
    const lines = container.querySelectorAll(selector);
    if (lines.length === 0) continue;
    return Array.from(lines)
      .map((line) => line.textContent.trim())
      .filter((line) => line !== '')
      .join('\n');
  }
  return container.textContent.trim();
};

const findContainer = () => {
  for (const selector of CONTAINER_SELECTORS) {
    const found = document.querySelector(selector);
    if (found !== null) return found;
  }
  return null;
};

export const createSiteCaptions = (onText, video = null) => {
  let container = null;
  let observer = null;
  let probeTimer = null;
  let isMirroring = false;
  let lastText = '';

  const emit = (text) => {
    if (!isMirroring || text === lastText) return;
    lastText = text;
    onText(text);
  };

  const readNow = () => {
    if (!isMirroring || container === null || !container.isConnected) return;
    emit(readLines(container));
  };

  const watch = (found) => {
    container = found;
    observer = new MutationObserver(readNow);
    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    readNow();
  };

  const unwatch = () => {
    if (observer !== null) observer.disconnect();
    observer = null;
    container = null;
  };

  // The container is created the moment captions are first switched on, which
  // may be long after the player opened, so it is looked for on a slow tick.
  const probe = () => {
    probeTimer = null;
    if (container !== null && !container.isConnected) unwatch();
    if (container === null) {
      const found = findContainer();
      if (found !== null) watch(found);
    } else {
      readNow();
    }
    probeTimer = setTimeout(probe, PROBE_INTERVAL_MS);
  };

  probe();

  return {
    // A site source is worth offering when the site can actually produce one.
    list: () => {
      const snap = captionsProbe(video);
      return snap !== null && Array.isArray(snap.list) ? snap.list : [];
    },
    hasContainer: () => container !== null,
    isOn: () => {
      const snap = captionsProbe(video);
      return snap !== null ? Boolean(snap.isOn) : container !== null;
    },
    activeIndex: () => {
      const snap = captionsProbe(video);
      return snap !== null && typeof snap.activeIndex === 'number'
        ? snap.activeIndex
        : 0;
    },
    select: (index) => {
      isMirroring = true;
      lastText = '';
      captionsSelect(video, index);
      readNow();
    },
    // The site's own caption layer sits behind the stage where nobody can see
    // it, so turning ours off is a matter of no longer mirroring it.
    disable: () => {
      isMirroring = false;
      lastText = '';
      captionsDisable(video);
      onText('');
    },
    destroy: () => {
      if (probeTimer !== null) clearTimeout(probeTimer);
      probeTimer = null;
      unwatch();
    },
  };
};
