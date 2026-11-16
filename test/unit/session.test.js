import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

registerHooks({
  load(url, context, next) {
    if (url.endsWith('.css')) {
      return {
        format: 'module',
        shortCircuit: true,
        source: 'export default "";',
      };
    }
    return next(url, context);
  },
});

const {
  captureVideoState,
  commitCapturedVolume,
  readOrientationAxis,
  readOrientationState,
  requestFullscreen,
  restoreVideoState,
} = await import('../../src/content/session.js');

const createMockVideo = ({
  volume = 0.8,
  muted = false,
  controls = true,
  loop = false,
} = {}) => {
  let hasControls = controls;
  return {
    volume,
    muted,
    loop,
    playbackRate: 1,
    style: { cssText: '' },
    parentNode: null,
    nextSibling: null,
    hasAttribute: (name) => (name === 'controls' ? hasControls : false),
    setAttribute: (name) => {
      if (name === 'controls') hasControls = true;
    },
    removeAttribute: (name) => {
      if (name === 'controls') hasControls = false;
    },
  };
};

test('restoreVideoState preserves committed volume after exit [G1]', () => {
  const video = createMockVideo({ volume: 0.8, muted: false });
  const state = captureVideoState(video);

  // Uncommitted mutation reverts on exit
  video.volume = 0.2;
  restoreVideoState(video, state);
  assert.equal(video.volume, 0.8);
  assert.equal(video.muted, false);

  // Committed vertical volume drag updates saved baseline so exit preserves it
  video.volume = 0.35;
  video.muted = false;
  commitCapturedVolume(state, video.volume, video.muted);
  restoreVideoState(video, state);
  assert.equal(video.volume, 0.35);
  assert.equal(video.muted, false);

  // Committed mute preserves muted state on exit
  video.volume = 0;
  video.muted = true;
  commitCapturedVolume(state, video.volume, video.muted);
  restoreVideoState(video, state);
  assert.equal(video.volume, 0);
  assert.equal(video.muted, true);
});

test('restoreVideoState restores MediaDocument controls attribute [D2]', () => {
  const withControls = createMockVideo({ controls: true });
  const state = captureVideoState(withControls);
  assert.equal(state.hasControlsAttribute, true);

  withControls.removeAttribute('controls');
  assert.equal(withControls.hasAttribute('controls'), false);

  restoreVideoState(withControls, state);
  assert.equal(withControls.hasAttribute('controls'), true);
});

test('restoreVideoState restores session-scoped loop property cleanly', () => {
  const normalVideo = createMockVideo({ loop: false });
  const stateA = captureVideoState(normalVideo);
  normalVideo.loop = true;
  restoreVideoState(normalVideo, stateA);
  assert.equal(normalVideo.loop, false);

  const loopedVideo = createMockVideo({ loop: true });
  const stateB = captureVideoState(loopedVideo);
  loopedVideo.loop = false;
  restoreVideoState(loopedVideo, stateB);
  assert.equal(loopedVideo.loop, true);
});

test('requestFullscreen passes navigationUI hide and falls back', async () => {
  const calls = [];
  const modern = {
    requestFullscreen: async (opts) => {
      calls.push(opts ?? null);
    },
  };
  assert.equal(
    await requestFullscreen(modern, { fullscreenEnabled: true }, true),
    true,
  );
  assert.deepEqual(calls, [{ navigationUI: 'hide' }]);

  const fallbackCalls = [];
  const legacy = {
    requestFullscreen: async (opts) => {
      fallbackCalls.push(opts ?? null);
      if (opts !== undefined) throw new TypeError('unsupported options');
    },
  };
  assert.equal(
    await requestFullscreen(legacy, { fullscreenEnabled: true }, true),
    true,
  );
  assert.deepEqual(fallbackCalls, [{ navigationUI: 'hide' }, null]);

  assert.equal(
    await requestFullscreen(modern, { fullscreenEnabled: false }, true),
    false,
  );

  const geckoCalls = [];
  const gecko = {
    requestFullscreen: async (opts) => {
      geckoCalls.push(opts ?? null);
    },
  };
  assert.equal(
    await requestFullscreen(gecko, { fullscreenEnabled: true }, false),
    true,
  );
  assert.deepEqual(geckoCalls, [null]);
});

test('readOrientationState distinguishes 180deg landscape flip', () => {
  const landA = {
    screen: { orientation: { type: 'landscape-primary', angle: 90 } },
  };
  const landB = {
    screen: { orientation: { type: 'landscape-secondary', angle: 270 } },
  };
  assert.equal(readOrientationAxis(landA), 'landscape');
  assert.equal(readOrientationAxis(landB), 'landscape');
  assert.equal(readOrientationState(landA), 'landscape-primary:90');
  assert.equal(readOrientationState(landB), 'landscape-secondary:270');
  assert.notEqual(readOrientationState(landA), readOrientationState(landB));

  const legacy = { innerWidth: 412, innerHeight: 915 };
  assert.equal(readOrientationAxis(legacy), 'portrait');
  assert.equal(readOrientationState(legacy), 'portrait:0');
});
