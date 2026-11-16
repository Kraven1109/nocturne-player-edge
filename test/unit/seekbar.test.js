import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  clampPreviewPercent,
  clampRatio,
  createSeekBar,
  ratioFromPointer,
} from '../../src/content/controls/seekbar.js';

const createEmitter = () => {
  const listeners = new Map();
  return {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent(event) {
      const payload = { stopPropagation: () => {}, ...event };
      const set = listeners.get(payload.type);
      if (!set) return true;
      for (const fn of Array.from(set)) fn(payload);
      return true;
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0;
    },
  };
};

const createMockNode = (tag) => {
  const emitter = createEmitter();
  const classes = new Set();
  const attrs = new Map();
  const styleProps = new Map();
  const children = [];

  const node = {
    tagName: tag.toUpperCase(),
    textContent: '',
    children,
    classList: {
      add: (...names) => names.forEach((n) => classes.add(n)),
      remove: (...names) => names.forEach((n) => classes.delete(n)),
      toggle: (name, force) => {
        const next = force === undefined ? !classes.has(name) : Boolean(force);
        if (next) classes.add(name);
        else classes.delete(name);
        return next;
      },
      contains: (name) => classes.has(name),
    },
    style: {
      setProperty: (k, v) => styleProps.set(k, String(v)),
      getPropertyValue: (k) => styleProps.get(k) ?? '',
    },
    setAttribute: (k, v) => attrs.set(k, String(v)),
    getAttribute: (k) => attrs.get(k) ?? null,
    append: (...nodes) => children.push(...nodes),
    replaceChildren: (...nodes) => {
      children.length = 0;
      children.push(...nodes);
    },
    setPointerCapture: () => {},
    getBoundingClientRect: () => ({
      left: 100,
      top: 300,
      width: 400,
      height: 14,
    }),
    ...emitter,
  };
  return node;
};

const withSeekBar = (
  t,
  { paused = false, duration = 100, currentTime = 10 } = {},
) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const prevDoc = globalThis.document;
  const createdVideos = [];
  const areas = [];
  const tracks = [];

  globalThis.document = {
    createElement: (tag) => {
      const node = createMockNode(tag);
      if (tag === 'video') createdVideos.push(node);
      return node;
    },
    createElementNS: (_ns, tag) => createMockNode(tag),
  };

  t.after(() => {
    globalThis.document = prevDoc;
  });

  const videoEmitter = createEmitter();
  let playCalls = 0;
  let pauseCalls = 0;
  const video = {
    duration,
    currentTime,
    paused,
    play: () => {
      playCalls += 1;
      video.paused = false;
      return Promise.resolve();
    },
    pause: () => {
      pauseCalls += 1;
      video.paused = true;
    },
    ...videoEmitter,
  };

  const seekCalls = [];
  const seek = (seconds, isFinal = true) => {
    seekCalls.push({ seconds, isFinal });
    return seconds;
  };

  const seekBar = createSeekBar(video, seek);
  // Walk root -> seek-row -> seek-area -> [track, previewBox]
  const row = seekBar.root.children[1];
  const area = row.children[1];
  const track = area.children[0];
  const previewBox = area.children[1];
  areas.push(area);
  tracks.push(track);

  return {
    seekBar,
    video,
    seekCalls,
    area,
    track,
    previewBox,
    createdVideos,
    counts: () => ({ playCalls, pauseCalls }),
  };
};

test('clampRatio bounds arbitrary inputs to [0, 1]', () => {
  assert.equal(clampRatio(-0.5), 0);
  assert.equal(clampRatio(0.42), 0.42);
  assert.equal(clampRatio(1.8), 1);
  assert.equal(clampRatio(NaN), 0);
});

test('ratioFromPointer maps track coordinates to fractional progress', () => {
  const rect = { left: 100, width: 400 };
  assert.equal(ratioFromPointer(100, rect), 0);
  assert.equal(ratioFromPointer(300, rect), 0.5);
  assert.equal(ratioFromPointer(400, rect), 0.75);
  assert.equal(ratioFromPointer(600, rect), 1);
  assert.equal(ratioFromPointer(50, rect), 0);
  assert.equal(ratioFromPointer(200, { left: 0, width: 0 }), 0);
});

test('clampPreviewPercent keeps preview pill away from track edges', () => {
  assert.equal(clampPreviewPercent(0), 8);
  assert.equal(clampPreviewPercent(0.5), 50);
  assert.equal(clampPreviewPercent(1), 92);
});

test('hover updates preview without seeking or creating video', (t) => {
  const ctx = withSeekBar(t);
  const { seekBar, area, previewBox, seekCalls, createdVideos } = ctx;
  assert.equal(previewBox.children.length, 2);
  assert.equal(createdVideos.length, 0);

  area.dispatchEvent({ type: 'pointermove', clientX: 300, clientY: 305 });
  assert.equal(seekBar.root.classList.contains('is-hovering'), true);
  assert.equal(area.style.getPropertyValue('--preview'), '50%');
  assert.equal(previewBox.children[1].textContent, '0:50');
  assert.equal(seekCalls.length, 0);
  assert.equal(createdVideos.length, 0);
});

test('hover is blocked while gesture scrub is active [B3]', (t) => {
  const { seekBar, area, seekCalls } = withSeekBar(t, { currentTime: 10 });

  seekBar.start();
  assert.equal(area.style.getPropertyValue('--preview'), '10%');

  // Pointer hover during gesture scrub must not overwrite scrub preview
  area.dispatchEvent({ type: 'pointermove', clientX: 500, clientY: 305 });
  assert.equal(seekBar.root.classList.contains('is-hovering'), false);
  assert.equal(area.style.getPropertyValue('--preview'), '10%');
  assert.equal(seekCalls.length, 0);

  seekBar.end();
});

test('scrub pauses playing video and resumes on end()', (t) => {
  const { area, video, seekCalls, counts } = withSeekBar(t, {
    paused: false,
    currentTime: 10,
  });

  area.dispatchEvent({
    type: 'pointerdown',
    button: 0,
    pointerId: 1,
    clientX: 200,
    clientY: 307,
  });
  assert.equal(counts().pauseCalls, 1);
  assert.equal(video.paused, true);
  assert.deepEqual(seekCalls[0], { seconds: 25, isFinal: false });

  area.dispatchEvent({
    type: 'pointerup',
    pointerId: 1,
    clientX: 200,
    clientY: 307,
  });
  assert.deepEqual(seekCalls[1], { seconds: 25, isFinal: true });
  assert.equal(counts().playCalls, 1);
  assert.equal(video.paused, false);
});

test('seeked-gating does not freeze across settles and scrubs [B1]', (t) => {
  const { area, video, seekCalls } = withSeekBar(t, { paused: true });

  // Scrub 1
  area.dispatchEvent({
    type: 'pointerdown',
    button: 0,
    pointerId: 1,
    clientX: 200,
    clientY: 307,
  });
  assert.equal(seekCalls.length, 1);
  assert.equal(seekCalls[0].seconds, 25);

  // Move while first seek in flight -> coalesces to pending
  area.dispatchEvent({
    type: 'pointermove',
    pointerId: 1,
    clientX: 260,
    clientY: 307,
  });
  area.dispatchEvent({
    type: 'pointermove',
    pointerId: 1,
    clientX: 300,
    clientY: 307,
  });
  assert.equal(seekCalls.length, 1);

  // First seek settles -> settle timer flushes latest target (50s)
  video.currentTime = 25;
  video.dispatchEvent({ type: 'seeked' });
  t.mock.timers.tick(60);
  assert.equal(seekCalls.length, 2);
  assert.deepEqual(seekCalls[1], { seconds: 50, isFinal: false });

  // Second seek settles -> move again -> must dispatch immediately
  video.currentTime = 50;
  video.dispatchEvent({ type: 'seeked' });
  t.mock.timers.tick(60);
  area.dispatchEvent({
    type: 'pointermove',
    pointerId: 1,
    clientX: 400,
    clientY: 307,
  });
  assert.equal(seekCalls.length, 3);
  assert.deepEqual(seekCalls[2], { seconds: 75, isFinal: false });

  area.dispatchEvent({
    type: 'pointerup',
    pointerId: 1,
    clientX: 400,
    clientY: 307,
  });
  assert.equal(seekCalls.length, 4);
  assert.deepEqual(seekCalls[3], { seconds: 75, isFinal: true });
});

test('ignores stale seeked outside epsilon and uses stall fallback', (t) => {
  const { area, video, seekCalls } = withSeekBar(t, { paused: true });

  area.dispatchEvent({
    type: 'pointerdown',
    button: 0,
    pointerId: 1,
    clientX: 200,
    clientY: 307,
  });
  area.dispatchEvent({
    type: 'pointermove',
    pointerId: 1,
    clientX: 300,
    clientY: 307,
  });

  // Orphan seeked at old time (10s vs requested 25s) must be ignored
  video.currentTime = 10;
  video.dispatchEvent({ type: 'seeked' });
  t.mock.timers.tick(60);
  assert.equal(seekCalls.length, 1);

  // Stall timer at 400ms unlocks and flushes pending 50s
  t.mock.timers.tick(340);
  assert.equal(seekCalls.length, 2);
  assert.deepEqual(seekCalls[1], { seconds: 50, isFinal: false });

  area.dispatchEvent({
    type: 'pointerup',
    pointerId: 1,
    clientX: 300,
    clientY: 307,
  });
});

test('destroy() finalizes mid-scrub and resumes playback [A2-4]', (t) => {
  const { seekBar, area, video, seekCalls, counts } = withSeekBar(t, {
    paused: false,
    currentTime: 10,
  });

  area.dispatchEvent({
    type: 'pointerdown',
    button: 0,
    pointerId: 1,
    clientX: 300,
    clientY: 307,
  });
  assert.equal(counts().pauseCalls, 1);
  assert.equal(video.paused, true);

  seekBar.destroy();
  assert.deepEqual(seekCalls[seekCalls.length - 1], {
    seconds: 50,
    isFinal: true,
  });
  assert.equal(counts().playCalls, 1);
  assert.equal(video.paused, false);
  assert.equal(video.listenerCount('seeked'), 0);
});
