import { call, findApiAncestor, isFunction } from './video/pageapi.js';
import { findEngines } from './video/engines.js';
import { ADAPTERS } from './video/qualityadapters.js';
import { createAudioTracks } from './video/audiotracks.js';
import { readChaptersSnapshot } from './page/chapters.main.js';
import { createYouTubeTracks } from './page/sitecaptions.main.js';
import {
  installFullscreenLock,
  setFullscreenLocked,
} from './page/fullscreen.main.js';

// MAIN-world agent injected at document_start.
// Bridges synchronous CustomEvent requests (`nocturne:req`) from the ISOLATED
// content script world to page-level player APIs (YouTube, hls.js, dash.js,
// Shaka, Playerjs) and answers on the same event.target (`nocturne:res`,
// bubbles: false).

const EVENT_REQUEST = 'nocturne:req';
const EVENT_RESPONSE = 'nocturne:res';
const MAX_RID_LENGTH = 64;

const PLAYER_API_MARKERS = [
  'getAvailableQualityLevels',
  'setPlaybackQualityRange',
  'getOption',
  'levels',
];

const ALLOWED_OPS = new Set([
  'ping',
  'engines',
  'cache-host',
  'quality.list',
  'quality.set',
  'audio.list',
  'audio.set',
  'captions.list',
  'captions.set',
  'captions.disable',
  'chapters.snapshot',
  'playerjs.id',
  'seek',
  'setVolume',
  'fullscreen.lock',
  'fullscreen.unlock',
]);

installFullscreenLock();

const states = new WeakMap();

const isInsideStage = (video) =>
  Boolean(video.closest && video.closest('[data-nocturne-player]'));

const ensureState = (video) => {
  let state = states.get(video);
  if (!state) {
    state = {
      host: isInsideStage(video)
        ? null
        : findApiAncestor(video, PLAYER_API_MARKERS),
      src: video.currentSrc || '',
      qualityAdapter: null,
      audio: null,
    };
    const invalidate = () => {
      state.src = video.currentSrc || '';
      state.qualityAdapter = null;
      state.audio = null;
      if (!isInsideStage(video)) {
        const freshHost = findApiAncestor(video, PLAYER_API_MARKERS);
        if (freshHost !== null) state.host = freshHost;
      }
    };
    video.addEventListener('emptied', invalidate);
    video.addEventListener('loadstart', invalidate);
    states.set(video, state);
    return state;
  }

  const currentSrc = video.currentSrc || '';
  if (currentSrc !== state.src) {
    state.src = currentSrc;
    state.qualityAdapter = null;
    state.audio = null;
  }
  if (!isInsideStage(video)) {
    const freshHost = findApiAncestor(video, PLAYER_API_MARKERS);
    if (freshHost !== null) state.host = freshHost;
  }
  return state;
};

const detectQualityAdapter = (video, host) => {
  for (const create of ADAPTERS) {
    try {
      const candidate = create(video, host);
      if (candidate !== null) return candidate;
    } catch (error) {
      console.warn('Nocturne: a quality adapter threw while probing', error);
    }
  }
  return null;
};

const reply = (target, detail) => {
  const node =
    target && typeof target.dispatchEvent === 'function'
      ? target
      : document.documentElement;
  node.dispatchEvent(
    new CustomEvent(EVENT_RESPONSE, { bubbles: false, detail }),
  );
};

const handleVideoOp = (video, op, request) => {
  const state = ensureState(video);

  if (op === 'cache-host') {
    if (!isInsideStage(video)) {
      state.host = findApiAncestor(video, PLAYER_API_MARKERS);
    }
    state.qualityAdapter = null;
    state.audio = null;
    return state.host !== null;
  }

  if (op === 'engines') {
    const found = findEngines(video, state.host);
    const summary = {};
    for (const key of Object.keys(found)) summary[key] = true;
    return summary;
  }

  if (op === 'quality.list') {
    const adapter = detectQualityAdapter(video, state.host);
    state.qualityAdapter = adapter;
    if (adapter === null) return null;
    return {
      name: adapter.name,
      hasAuto: Boolean(adapter.hasAuto),
      options: adapter.list(),
      current: adapter.current(),
      diagnosis:
        typeof adapter.diagnose === 'function' ? adapter.diagnose() : null,
    };
  }

  if (op === 'quality.set') {
    if (typeof request.id !== 'string' || request.id === '') return false;
    const adapter =
      state.qualityAdapter ?? detectQualityAdapter(video, state.host);
    state.qualityAdapter = adapter;
    if (adapter === null) return false;
    return adapter.select(request.id) === true;
  }

  if (op === 'audio.list') {
    if (state.audio === null) {
      state.audio = createAudioTracks(video, state.host);
    }
    const options = state.audio.refresh();
    if (options.length === 0) return null;
    return {
      options,
      current: state.audio.getCurrent(),
    };
  }

  if (op === 'audio.set') {
    if (typeof request.id !== 'string' || request.id === '') return false;
    if (state.audio === null) {
      state.audio = createAudioTracks(video, state.host);
      state.audio.refresh();
    }
    return state.audio.select(request.id) === true;
  }

  if (op === 'captions.list') {
    const yt = createYouTubeTracks(state.host);
    if (yt === null) return null;
    return {
      list: yt.list(),
      isOn: yt.isOn(),
      activeIndex: yt.activeIndex(),
    };
  }

  if (op === 'captions.set') {
    const index = request.index;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
      return false;
    }
    const yt = createYouTubeTracks(state.host);
    if (yt === null) return false;
    return yt.select(index) === true;
  }

  if (op === 'captions.disable') {
    const yt = createYouTubeTracks(state.host);
    if (yt === null) return false;
    yt.disable();
    return true;
  }

  if (op === 'chapters.snapshot') {
    return readChaptersSnapshot(state.host);
  }

  if (op === 'playerjs.id') {
    const player = findEngines(video, state.host).playerjs ?? null;
    if (player === null) return null;
    const id = call(player, 'api', 'id');
    return typeof id === 'string' && id !== '' ? id : null;
  }

  if (op === 'seek') {
    const seconds = request.seconds;
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return false;
    if (state.host === null || !isFunction(state.host, 'seekTo')) return false;
    // YouTube's seekTo(seconds, false) does not update <video>.currentTime at
    // all; seekbar previews are paused and seeked-gated, so passing true lets
    // the main video display preview frames directly while scrubbing.
    call(state.host, 'seekTo', seconds, true);
    return true;
  }

  if (op === 'setVolume') {
    const volume = request.volume;
    const muted = request.muted;
    if (
      typeof volume !== 'number' ||
      !Number.isFinite(volume) ||
      typeof muted !== 'boolean'
    ) {
      return false;
    }
    if (state.host === null || !isFunction(state.host, 'setVolume')) {
      return false;
    }
    const clamped = Math.max(0, Math.min(100, Math.round(volume)));
    call(state.host, 'setVolume', clamped);
    call(state.host, muted ? 'mute' : 'unMute');
    return true;
  }

  return null;
};

const onRequest = (event) => {
  const request = event.detail;
  if (request === null || typeof request !== 'object') return;

  const { rid, op } = request;
  if (typeof rid !== 'string' || rid === '' || rid.length > MAX_RID_LENGTH) {
    return;
  }
  if (typeof op !== 'string' || !ALLOWED_OPS.has(op)) {
    reply(event.target, { rid, ok: false, error: 'unknown-op' });
    return;
  }

  if (op === 'ping') {
    reply(event.target, { rid, ok: true, value: 'pong' });
    return;
  }

  if (op === 'fullscreen.lock') {
    setFullscreenLocked(true);
    reply(event.target, { rid, ok: true, value: true });
    return;
  }

  if (op === 'fullscreen.unlock') {
    setFullscreenLocked(false);
    reply(event.target, { rid, ok: true, value: true });
    return;
  }

  const target = event.target;
  if (!target || target.nodeName !== 'VIDEO') {
    reply(target, { rid, ok: false, error: 'invalid-target' });
    return;
  }

  try {
    const value = handleVideoOp(target, op, request);
    reply(target, { rid, ok: true, value });
  } catch (error) {
    console.warn(`Nocturne: pageagent op ${op} failed`, error);
    reply(target, { rid, ok: false, error: 'op-failed' });
  }
};

// Capture phase: a site's own player cannot swallow the request on its way
// down, and event.target is still the element the isolated world chose.
document.addEventListener(EVENT_REQUEST, onRequest, true);
