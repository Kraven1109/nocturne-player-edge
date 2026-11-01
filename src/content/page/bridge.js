// Synchronous CustomEvent bridge client for the ISOLATED content script world.
//
// In Blink, dispatching a CustomEvent invokes listeners across both ISOLATED
// and MAIN worlds synchronously before dispatchEvent() returns. Requests carry
// bubbles: true so the MAIN agent's capture listener on `document` receives
// `event.target` (the <video> element) as the WeakMap identity key. Responses
// carry bubbles: false on that same target.

const EVENT_REQUEST = 'nocturne:req';
const EVENT_RESPONSE = 'nocturne:res';

const PAGE_OPS = new Set(['fullscreen.lock', 'fullscreen.unlock']);

let nextRequestId = 0;

export const requestSync = (target, op, fields = {}) => {
  const isPageOp = PAGE_OPS.has(op);
  const node = isPageOp ? document.documentElement : target;

  if (!node || typeof node.dispatchEvent !== 'function') return null;
  if (!isPageOp && !node.isConnected) return null;

  nextRequestId += 1;
  const rid = `r${nextRequestId}`;
  let response = null;

  const onResponse = (event) => {
    const detail = event.detail;
    if (detail !== null && typeof detail === 'object' && detail.rid === rid) {
      response = detail;
    }
  };

  node.addEventListener(EVENT_RESPONSE, onResponse);
  try {
    node.dispatchEvent(
      new CustomEvent(EVENT_REQUEST, {
        bubbles: true,
        detail: { ...fields, rid, op },
      }),
    );
  } finally {
    node.removeEventListener(EVENT_RESPONSE, onResponse);
  }

  if (response === null || response.ok !== true) return null;
  return response.value;
};

export const ping = (video = null) =>
  requestSync(video ?? document.documentElement, 'ping');

export const cacheHost = (video) => requestSync(video, 'cache-host') === true;

export const qualityProbe = (video) => requestSync(video, 'quality.list');

export const qualitySelect = (video, id) =>
  requestSync(video, 'quality.set', { id: String(id) }) === true;

export const audioProbe = (video) => requestSync(video, 'audio.list');

export const audioSelect = (video, id) =>
  requestSync(video, 'audio.set', { id: String(id) }) === true;

export const captionsProbe = (video) => requestSync(video, 'captions.list');

export const captionsSelect = (video, index) =>
  requestSync(video, 'captions.set', { index: Number(index) }) === true;

export const captionsDisable = (video) =>
  requestSync(video, 'captions.disable') === true;

const EMPTY_CHAPTERS = { videoId: null, isAd: false, chapters: [] };

// Everything crossing from the page's world is data the page could have
// shaped, so it is rebuilt field by field rather than passed on.
export const chaptersSnapshot = (video) => {
  const snap = requestSync(video, 'chapters.snapshot');
  if (snap === null || typeof snap !== 'object') return EMPTY_CHAPTERS;

  const chapters = Array.isArray(snap.chapters)
    ? snap.chapters
        .filter(
          (chapter) =>
            chapter !== null &&
            typeof chapter === 'object' &&
            typeof chapter.title === 'string' &&
            Number.isFinite(chapter.start),
        )
        .map((chapter) => ({ title: chapter.title, start: chapter.start }))
    : [];

  return {
    videoId:
      typeof snap.videoId === 'string' && snap.videoId !== ''
        ? snap.videoId
        : null,
    isAd: snap.isAd === true,
    chapters,
  };
};

export const playerjsId = (video) => {
  const id = requestSync(video, 'playerjs.id');
  return typeof id === 'string' && id !== '' ? id : null;
};

export const seekOnSite = (video, seconds, isFinal = true) =>
  requestSync(video, 'seek', {
    seconds: Number(seconds),
    isFinal: Boolean(isFinal),
  }) === true;

export const lockFullscreen = () =>
  requestSync(document.documentElement, 'fullscreen.lock') === true;

export const unlockFullscreen = () =>
  requestSync(document.documentElement, 'fullscreen.unlock') === true;

export const createBridgeQualityAdapter = (video) => {
  const snap = qualityProbe(video);
  if (snap === null || typeof snap !== 'object') return null;

  const adapter = {
    name: typeof snap.name === 'string' ? snap.name : 'site',
    hasAuto: Boolean(snap.hasAuto),
    list: () => (Array.isArray(snap.options) ? snap.options : []),
    current: () => (typeof snap.current === 'string' ? snap.current : null),
    select: (id) => qualitySelect(video, id),
  };

  if (typeof snap.diagnosis === 'string') {
    adapter.diagnose = () => snap.diagnosis;
  }

  return adapter;
};

export const createBridgeAudioTracks = (video) => {
  let options = [];
  let current = null;
  let chosen = null;

  const refresh = () => {
    const snap = audioProbe(video);
    options = snap !== null && Array.isArray(snap.options) ? snap.options : [];
    current =
      snap !== null && typeof snap.current === 'string' ? snap.current : null;
    if (!options.some((option) => option.id === chosen)) chosen = null;
    return options;
  };

  return {
    refresh,
    getOptions: () => options,
    isSwitchable: () => options.length > 1,
    getCurrent: () => (chosen !== null ? chosen : current),
    select: (id) => {
      const wanted = String(id);
      if (!audioSelect(video, wanted)) return false;
      chosen = wanted;
      return true;
    },
  };
};
