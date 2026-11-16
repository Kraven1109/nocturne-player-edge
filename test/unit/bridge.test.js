import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  chaptersSnapshot,
  createBridgeAudioTracks,
  createBridgeQualityAdapter,
  requestSync,
  setSiteLoop,
  setSiteVolume,
} from '../../src/content/page/bridge.js';

const createMockElement = ({ isConnected = true, onDispatch = null } = {}) => {
  const listeners = new Map();
  const dispatched = [];

  const target = {
    isConnected,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent(event) {
      dispatched.push(event);
      if (onDispatch) onDispatch(target, event);
      const set = listeners.get(event.type);
      if (set) {
        for (const fn of Array.from(set)) fn(event);
      }
      return true;
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0;
    },
    dispatched,
  };
  return target;
};

test('detached video returns null without dispatching or leaking', () => {
  const video = createMockElement({ isConnected: false });
  const res = requestSync(video, 'quality.list');
  assert.equal(res, null);
  assert.equal(video.dispatched.length, 0);
  assert.equal(video.listenerCount('nocturne:res'), 0);
});

test('unanswered request returns null and removes listener', () => {
  const video = createMockElement({ isConnected: true });
  const res = requestSync(video, 'quality.list');
  assert.equal(res, null);
  assert.equal(video.dispatched.length, 1);
  assert.equal(video.listenerCount('nocturne:res'), 0);
});

test('synchronous response matching rid returns value and cleans up', () => {
  const video = createMockElement({
    isConnected: true,
    onDispatch(node, reqEvent) {
      if (reqEvent.type !== 'nocturne:req') return;
      const { rid, op } = reqEvent.detail;
      node.dispatchEvent(
        new CustomEvent('nocturne:res', {
          bubbles: false,
          detail: { rid, ok: true, value: `handled:${op}` },
        }),
      );
    },
  });

  const res = requestSync(video, 'ping');
  assert.equal(res, 'handled:ping');
  assert.equal(video.listenerCount('nocturne:res'), 0);
});

test('bridge quality and audio adapters expose sync contracts', () => {
  let selectedQuality = null;
  let selectedAudio = null;

  const video = createMockElement({
    isConnected: true,
    onDispatch(node, reqEvent) {
      if (reqEvent.type !== 'nocturne:req') return;
      const { rid, op, id } = reqEvent.detail;
      let value = null;
      if (op === 'quality.list') {
        value = {
          name: 'youtube',
          hasAuto: true,
          options: [{ id: 'hd1080', label: '1080p' }],
          current: 'hd1080',
          diagnosis: '1 listed',
        };
      } else if (op === 'quality.set') {
        selectedQuality = id;
        value = true;
      } else if (op === 'audio.list') {
        value = {
          options: [
            { id: '0', label: 'English' },
            { id: '1', label: 'Vietnamese' },
          ],
          current: '0',
        };
      } else if (op === 'audio.set') {
        selectedAudio = id;
        value = true;
      }
      node.dispatchEvent(
        new CustomEvent('nocturne:res', {
          bubbles: false,
          detail: { rid, ok: true, value },
        }),
      );
    },
  });

  const qAdapter = createBridgeQualityAdapter(video);
  assert.equal(qAdapter.name, 'youtube');
  assert.equal(qAdapter.hasAuto, true);
  assert.deepEqual(qAdapter.list(), [{ id: 'hd1080', label: '1080p' }]);
  assert.equal(qAdapter.current(), 'hd1080');
  assert.equal(qAdapter.diagnose(), '1 listed');
  assert.equal(qAdapter.select('hd1080'), true);
  assert.equal(selectedQuality, 'hd1080');

  const audio = createBridgeAudioTracks(video);
  assert.equal(audio.refresh().length, 2);
  assert.equal(audio.isSwitchable(), true);
  assert.equal(audio.getCurrent(), '0');
  assert.equal(audio.select('1'), true);
  assert.equal(selectedAudio, '1');
  assert.equal(audio.getCurrent(), '1');
});

const answering = (value) =>
  createMockElement({
    onDispatch(node, event) {
      if (event.type !== 'nocturne:req') return;
      node.dispatchEvent(
        new CustomEvent('nocturne:res', {
          detail: { rid: event.detail.rid, ok: true, value },
        }),
      );
    },
  });

test('chaptersSnapshot rebuilds the page answer field by field', () => {
  const video = answering({
    videoId: 'B',
    isAd: true,
    extra: 'dropped',
    chapters: [
      { title: 'One', start: 0, extra: 1 },
      { title: 5, start: 10 },
      { title: 'NaN', start: NaN },
      null,
    ],
  });
  assert.deepEqual(chaptersSnapshot(video), {
    videoId: 'B',
    isAd: true,
    chapters: [{ title: 'One', start: 0 }],
  });
});

test('chaptersSnapshot is empty when nothing usable answers', () => {
  const empty = { videoId: null, isAd: false, chapters: [] };
  assert.deepEqual(chaptersSnapshot(createMockElement()), empty);
  assert.deepEqual(chaptersSnapshot(answering('nope')), empty);
  assert.deepEqual(chaptersSnapshot(answering({ videoId: '' })), empty);
});

test('setSiteVolume rounds 0..100 integer and sends muted flag', () => {
  const video = answering(true);
  assert.equal(setSiteVolume(video, 0.724, false), true);
  assert.equal(setSiteVolume(video, -0.4, true), true);

  const requests = video.dispatched.filter((e) => e.type === 'nocturne:req');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].detail.op, 'setVolume');
  assert.equal(requests[0].detail.volume, 72);
  assert.equal(requests[0].detail.muted, false);
  assert.equal(requests[1].detail.volume, 0);
  assert.equal(requests[1].detail.muted, true);

  assert.equal(setSiteVolume(createMockElement(), 0.5, false), false);
});

test('setSiteLoop dispatches op setLoop with boolean enabled flag', () => {
  const video = answering(true);
  assert.equal(setSiteLoop(video, true), true);
  assert.equal(setSiteLoop(video, 0), true);
  const requests = video.dispatched.filter((e) => e.type === 'nocturne:req');
  assert.equal(requests[0].detail.op, 'setLoop');
  assert.equal(requests[0].detail.enabled, true);
  assert.equal(requests[1].detail.enabled, false);
  assert.equal(setSiteLoop(createMockElement(), true), false);
});
