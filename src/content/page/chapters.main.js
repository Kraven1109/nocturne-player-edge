import { call, pageWindow, read, toArray } from '../video/pageapi.js';

// YouTube ships its chapter list inside the blob of data it renders the page
// from. It sits in a different place on the phone site than on the desktop one,
// under a different renderer, and moves without notice — so rather than
// following one path down, the renderers are looked for by name, in every blob
// the page is willing to show us, with a node budget so a page that turns out
// to be a maze cannot cost more than a moment.
const MAX_NODES = 30000;
const MAX_RENDERER_NODES = 400;
const MS_PER_SECOND = 1000;
const MIN_CHAPTERS = 2;

const RENDERER_KEYS = ['chapterRenderer', 'macroMarkersListItemRenderer'];

const readTitle = (renderer) => {
  const title = read(renderer, 'title');
  const simple = read(title, 'simpleText');
  if (typeof simple === 'string' && simple !== '') return simple;

  const runs = toArray(read(title, 'runs'))
    .map((run) => read(run, 'text'))
    .filter((text) => typeof text === 'string');
  return runs.join('');
};

// The start time is spelled two ways and buried at a different depth in each
// shape, so it is searched for within the renderer rather than reached for.
const readStart = (renderer) => {
  const stack = [renderer];
  let budget = MAX_RENDERER_NODES;

  while (stack.length > 0 && budget > 0) {
    const node = stack.pop();
    budget -= 1;
    if (node === null || typeof node !== 'object') continue;

    const millis = Number(read(node, 'timeRangeStartMillis'));
    if (Number.isFinite(millis)) return millis / MS_PER_SECOND;

    const seconds = Number(read(node, 'startTimeSeconds'));
    if (Number.isFinite(seconds)) return seconds;

    let keys;
    try {
      keys = Object.keys(node);
    } catch {
      continue;
    }
    for (const key of keys) stack.push(read(node, key));
  }
  return null;
};

const readChapter = (node) => {
  for (const key of RENDERER_KEYS) {
    const renderer = read(node, key);
    if (renderer === null) continue;

    const title = readTitle(renderer);
    const start = readStart(renderer);
    if (title === '' || start === null) continue;
    return { title, start };
  }
  return null;
};

const collect = (root) => {
  const found = [];
  const stack = [root];
  let budget = MAX_NODES;

  while (stack.length > 0 && budget > 0) {
    const node = stack.pop();
    budget -= 1;
    if (node === null || typeof node !== 'object') continue;

    const chapter = readChapter(node);
    if (chapter !== null) {
      found.push(chapter);
      continue;
    }

    let keys;
    try {
      keys = Object.keys(node);
    } catch {
      continue;
    }
    for (const key of keys) stack.push(read(node, key));
  }

  return found;
};

const tidy = (chapters) => {
  const byStart = new Map();
  for (const chapter of chapters) {
    if (!byStart.has(chapter.start)) byStart.set(chapter.start, chapter);
  }
  const sorted = Array.from(byStart.values()).sort(
    (first, second) => first.start - second.start,
  );
  // One chapter is not a chapter list, it is the whole film with a label on it.
  return sorted.length >= MIN_CHAPTERS ? sorted : [];
};

// Both blobs name the video they describe, in a different place each.
const readVideoId = (data) => {
  const endpoint = read(read(data, 'currentVideoEndpoint'), 'watchEndpoint');
  const id =
    read(endpoint, 'videoId') ?? read(read(data, 'videoDetails'), 'videoId');
  return typeof id === 'string' && id !== '' ? id : null;
};

const readLocationVideoId = () => {
  if (typeof location === 'undefined') return null;
  try {
    return new URL(location.href).searchParams.get('v') || null;
  } catch {
    return null;
  }
};

// Three places name the video that is playing; the player's own are tried
// first, the address bar last because it is the same on every site.
const readLiveId = (playerHost, playerResponse) => {
  const fromPlayer = read(call(playerHost, 'getVideoData'), 'video_id');
  return (
    readVideoId(playerResponse) ??
    (typeof fromPlayer === 'string' && fromPlayer !== '' ? fromPlayer : null) ??
    readLocationVideoId()
  );
};

// An advertisement plays in the same element with the film's own id, and its
// length is not the film's, so chapters drawn over it would sit in the wrong
// places.
const isAdShowing = (playerHost) =>
  call(read(playerHost, 'classList'), 'contains', 'ad-showing') === true;

// The player's own answer is the only one certainly about the video playing
// right now, but on YouTube it carries no chapters: those ride in the page's
// watch data. That data is live in <ytd-watch-flexy> after a navigation, while
// the ytInitial* globals stay frozen at whatever page was loaded first — so a
// blob is only trusted when it names the video that is playing. One that names
// nothing is read as before, so a layout we have not seen does not lose
// chapters.
export const readChaptersSnapshot = (playerHost = null) => {
  const playerResponse = call(playerHost, 'getPlayerResponse');
  const videoId = readLiveId(playerHost, playerResponse);
  const isAd = isAdShowing(playerHost);
  if (isAd) return { videoId, isAd, chapters: [] };

  const scope = pageWindow();
  const flexy =
    typeof document === 'undefined'
      ? null
      : document.querySelector('ytd-watch-flexy');
  const sources = [
    playerResponse,
    read(flexy, 'data'),
    read(scope, 'ytInitialData'),
    read(scope, 'ytInitialPlayerResponse'),
  ];

  for (const source of sources) {
    if (source === null) continue;
    const id = readVideoId(source);
    if (videoId !== null && id !== null && id !== videoId) continue;
    const chapters = tidy(collect(source));
    if (chapters.length > 0) return { videoId, isAd, chapters };
  }
  return { videoId, isAd, chapters: [] };
};

export const readSiteChapters = (playerHost = null) =>
  readChaptersSnapshot(playerHost).chapters;
