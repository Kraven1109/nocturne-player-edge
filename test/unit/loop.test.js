import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createLooper,
  isLoopAllowedForVideo,
} from '../../src/content/video/loop.js';

test('isLoopAllowedForVideo rejects 0x0 audio-only and feed videos', () => {
  assert.equal(
    isLoopAllowedForVideo({
      viewportWidth: 1280,
      viewportHeight: 800,
      videoWidth: 0,
      videoHeight: 0,
    }),
    false,
  );
  assert.equal(
    isLoopAllowedForVideo({
      viewportWidth: 412,
      viewportHeight: 915,
      videoWidth: 720,
      videoHeight: 1280,
    }),
    false,
  );
  assert.equal(
    isLoopAllowedForVideo({
      viewportWidth: 1280,
      viewportHeight: 800,
      videoWidth: 1280,
      videoHeight: 544,
    }),
    true,
  );
});

test('createLooper respects isAllowed and toggles default video.loop', () => {
  let allowed = true;
  const video = { loop: false, isConnected: false };
  const looper = createLooper(video, { isAllowed: () => allowed });

  assert.equal(looper.isAllowed(), true);
  assert.equal(looper.set(true), true);
  assert.equal(video.loop, true);
  assert.equal(looper.isLooping(), true);

  allowed = false;
  assert.equal(looper.set(false), false);
  assert.equal(video.loop, false);
  assert.equal(looper.set(true), false);
  assert.equal(video.loop, false);
});

test('createLooper delegates completely to injected adapter read/apply', () => {
  const video = { loop: false };
  let siteLoop = false;
  const calls = [];
  const looper = createLooper(video, {
    isAllowed: () => true,
    apply: (next) => {
      calls.push(next);
      siteLoop = next;
    },
    read: () => siteLoop,
  });

  assert.equal(looper.set(true), true);
  assert.equal(looper.isLooping(), true);
  assert.equal(video.loop, false);
  assert.deepEqual(calls, [true]);

  assert.equal(looper.set(false), false);
  assert.equal(looper.isLooping(), false);
  assert.deepEqual(calls, [true, false]);
});
