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

const { captureVideoState, commitCapturedVolume, restoreVideoState } =
  await import('../../src/content/session.js');

const createMockVideo = ({
  volume = 0.8,
  muted = false,
  controls = true,
} = {}) => {
  let hasControls = controls;
  return {
    volume,
    muted,
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
