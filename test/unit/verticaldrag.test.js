import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  computeDimStep,
  computeVolumeStep,
  createDimDrag,
  createVolumeDrag,
  DIM_AUTO_LABEL,
} from '../../src/content/gestures/verticaldrag.js';

test('dim anchor math at h=800 matches 2-way AUTO hysteresis [G2, H3]', () => {
  const height = 800; // 0.75 * 800 = 600px span

  // Pulling up from AUTO stays AUTO
  const up = computeDimStep({
    dragBase: 1,
    totalDy: -40,
    height,
    enteredAutoFromBottom: false,
  });
  assert.equal(up.level, null);
  assert.equal(up.opacity, 0);
  assert.equal(up.label, DIM_AUTO_LABEL);

  // Pull down +300px -> Dim: 50%, opacity 0.5
  const mid = computeDimStep({
    dragBase: 1,
    totalDy: 300,
    height,
    enteredAutoFromBottom: false,
  });
  assert.equal(mid.level, 0.5);
  assert.equal(mid.opacity, 0.5);
  assert.equal(mid.label, 'Dim: 50%');

  // Pull down +540px -> exact floor 0.10, still Dim: 10%
  const floor = computeDimStep({
    dragBase: 1,
    totalDy: 540,
    height,
    enteredAutoFromBottom: false,
  });
  assert.equal(floor.level, 0.1);
  assert.equal(floor.opacity, 0.9);
  assert.equal(floor.label, 'Dim: 10%');
  assert.equal(floor.enteredAutoFromBottom, false);

  // Pull down +564px -> exact 24px extra threshold with FP tolerance [H3]
  const exactEdge = computeDimStep({
    dragBase: 1,
    totalDy: 564,
    height,
    enteredAutoFromBottom: false,
  });
  assert.equal(exactEdge.level, null);
  assert.equal(exactEdge.opacity, 0);
  assert.equal(exactEdge.enteredAutoFromBottom, true);

  // Pull down +580px -> AUTO
  const deepAuto = computeDimStep({
    dragBase: 1,
    totalDy: 580,
    height,
    enteredAutoFromBottom: false,
  });
  assert.equal(deepAuto.level, null);
  assert.equal(deepAuto.enteredAutoFromBottom, true);

  // Reverse up in same drag to +528px (raw = 0.12 < 0.14): stays in AUTO
  const stillAuto = computeDimStep({
    dragBase: 1,
    totalDy: 528,
    height,
    enteredAutoFromBottom: true,
  });
  assert.equal(stillAuto.level, null);
  assert.equal(stillAuto.enteredAutoFromBottom, true);

  // Reverse up further to +516px (raw = 0.14): exits AUTO back to 14%
  const exitAuto = computeDimStep({
    dragBase: 1,
    totalDy: 516,
    height,
    enteredAutoFromBottom: true,
  });
  assert.ok(Math.abs(exitAuto.level - 0.14) < 1e-9);
  assert.equal(exitAuto.opacity, 0.86);
  assert.equal(exitAuto.label, 'Dim: 14%');
  assert.equal(exitAuto.enteredAutoFromBottom, false);
});

test('dim overshoot recovers symmetrically via anchor raw math [G2]', () => {
  const height = 800; // span = 600
  const dragBase = 0.5;
  // Drag past floor (+450px => raw=-0.25) then back up to +210px (raw=0.15)
  const bottom = computeDimStep({
    dragBase,
    totalDy: 450,
    height,
    enteredAutoFromBottom: false,
  });
  assert.equal(bottom.level, null);
  assert.equal(bottom.enteredAutoFromBottom, true);

  const recovered = computeDimStep({
    dragBase,
    totalDy: 210,
    height,
    enteredAutoFromBottom: bottom.enteredAutoFromBottom,
  });
  assert.ok(Math.abs(recovered.level - 0.15) < 1e-9);
  assert.equal(recovered.label, 'Dim: 15%');
});

test('small viewport h=300 uses raw < 0.05 fallback to enter AUTO', () => {
  const height = 300; // span = 225; 24/225 = 0.1067
  const step = computeDimStep({
    dragBase: 0.2,
    totalDy: 36, // raw = 0.2 - 0.16 = 0.04 < 0.05
    height,
    enteredAutoFromBottom: false,
  });
  assert.equal(step.level, null);
  assert.equal(step.label, DIM_AUTO_LABEL);
  assert.equal(step.enteredAutoFromBottom, true);
});

test('volume anchor math clamps to [0, 1] and mutes at 0%', () => {
  const muteStep = computeVolumeStep({
    dragBase: 0.4,
    totalDy: 500,
    height: 800,
  });
  assert.equal(muteStep.volume, 0);
  assert.equal(muteStep.isMuted, true);
  assert.equal(muteStep.label, 'Muted');

  const upStep = computeVolumeStep({
    dragBase: 0.5,
    totalDy: -132,
    height: 800,
  });
  assert.equal(upStep.isMuted, false);
  assert.equal(Math.round(upStep.volume * 100), 72);
  assert.equal(upStep.label, 'Volume: 72%');

  const ceiling = computeVolumeStep({
    dragBase: 0.8,
    totalDy: -300,
    height: 800,
  });
  assert.equal(ceiling.volume, 1);
  assert.equal(ceiling.label, 'Volume: 100%');
});

test('createDimDrag toggles is-dragging class and end() is idempotent', () => {
  const classes = new Set();
  const dimLayer = {
    style: { opacity: '0' },
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
    },
  };
  const toasts = [];
  const dimDrag = createDimDrag({
    dimLayer,
    showToast: (text, duration) => toasts.push([text, duration]),
    toastMs: 900,
  });

  dimDrag.start();
  assert.equal(classes.has('is-dragging'), true);
  dimDrag.move({ totalDy: 300, height: 800 });
  assert.equal(dimLayer.style.opacity, '0.5');
  assert.deepEqual(toasts[0], ['Dim: 50%', null]);

  dimDrag.end();
  dimDrag.end();
  assert.equal(classes.has('is-dragging'), false);
  assert.deepEqual(toasts.slice(1), [['Dim: 50%', 900]]);

  dimDrag.reset();
  assert.equal(dimLayer.style.opacity, '0');
});

test('createVolumeDrag commits once and syncs video volume/muted [H2]', () => {
  const video = { volume: 0.5, muted: false };
  const commits = [];
  const toasts = [];
  const volumeDrag = createVolumeDrag({
    video,
    onCommit: (vol, muted) => commits.push([vol, muted]),
    showToast: (text, duration) => toasts.push([text, duration]),
    toastMs: 900,
  });

  volumeDrag.start();
  volumeDrag.move({ totalDy: -150, height: 800 }); // 0.5 + 0.25 = 0.75
  assert.equal(video.volume, 0.75);
  assert.equal(video.muted, false);
  assert.deepEqual(toasts[0], ['Volume: 75%', null]);

  volumeDrag.end();
  volumeDrag.end();
  assert.deepEqual(commits, [[0.75, false]]);
  assert.deepEqual(toasts.slice(1), [['Volume: 75%', 900]]);
});
