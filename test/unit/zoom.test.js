import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createVisuals } from '../../src/content/video/visuals.js';
import {
  clampPan,
  clampScale,
  computeCoverScale,
  computeDrawSize,
  computeFocalPan,
  computeMaxScale,
  snapPinchScale,
  snapScale,
} from '../../src/content/video/zoom.js';

const close = (actual, expected) =>
  assert.ok(
    Math.abs(actual - expected) < 1e-6,
    `expected ${actual} to be about ${expected}`,
  );

test('cover scale crops a letterboxed widescreen picture', () => {
  close(computeCoverScale(1280, 544, 2340, 1080), 1280 / 544 / (2340 / 1080));
});

test('cover scale fills a pillarboxed 4:3 picture', () => {
  close(computeCoverScale(640, 480, 2340, 1080), 2340 / 1080 / (640 / 480));
});

test('cover scale is 1 when the aspects already match', () => {
  close(computeCoverScale(1920, 1080, 1280, 720), 1);
});

test('cover scale falls back to 1 on unusable dimensions', () => {
  assert.equal(computeCoverScale(0, 0, 100, 100), 1);
  assert.equal(computeCoverScale(100, 100, 0, 0), 1);
});

test('scale is clamped between fit and the fill scale', () => {
  assert.equal(clampScale(0.2, 1.6), 1);
  assert.equal(clampScale(1.4, 1.6), 1.4);
  assert.equal(clampScale(12, 1.6), 1.6);
});

test('a picture that already fits cannot be zoomed at all', () => {
  assert.equal(clampScale(2, 1), 1);
  assert.equal(clampScale(2, 0.5), 1);
});

test('scale snaps to a nearby target and leaves others alone', () => {
  assert.equal(snapScale(1.01, [1, 1.5]), 1);
  assert.equal(snapScale(1.48, [1, 1.5]), 1.5);
  assert.equal(snapScale(1.25, [1, 1.5]), 1.25);
});

test('pan cannot expose an edge', () => {
  assert.deepEqual(clampPan(500, 500, 1, 800, 400), { x: 0, y: 0 });
  assert.deepEqual(clampPan(500, 500, 2, 800, 400), { x: 400, y: 200 });
  assert.deepEqual(clampPan(-500, -500, 2, 800, 400), { x: -400, y: -200 });
  assert.deepEqual(clampPan(100, 50, 2, 800, 400), { x: 100, y: 50 });
});

test('free-zoom policy preserves arbitrary scales past 1x [M2]', () => {
  assert.equal(computeMaxScale(1), 4);
  assert.equal(computeMaxScale(5.5), 5.5);
  assert.equal(snapPinchScale(2.5, 1), 2.5);
  assert.equal(snapPinchScale(3.5, 2.844), 3.5);
  assert.equal(snapPinchScale(1.02, 1), 1);
  assert.equal(snapPinchScale(2.8, 2.844), 2.844);
  assert.equal(snapPinchScale(6, 1), 4);
});

test('computeDrawSize computes rotated screen-space AABB bounds [M4]', () => {
  const landscape0 = computeDrawSize(1920, 1080, 800, 1280, 0);
  close(landscape0.drawWidth, 800);
  close(landscape0.drawHeight, 450);
  close(landscape0.baseScale, 1);

  const landscape90 = computeDrawSize(1920, 1080, 800, 1280, 90);
  close(landscape90.drawWidth, 720);
  close(landscape90.drawHeight, 1280);
  close(landscape90.baseScale, 1.6);

  const portrait0 = computeDrawSize(1080, 1920, 800, 1280, 0);
  close(portrait0.drawWidth, 720);
  close(portrait0.drawHeight, 1280);
  close(portrait0.baseScale, 1);

  const portrait90 = computeDrawSize(1080, 1920, 800, 1280, 90);
  close(portrait90.drawWidth, 800);
  close(portrait90.drawHeight, 450);
  close(portrait90.baseScale, 0.625);

  // Letterboxed 800x450 inside 800x1280 at 2x overflows X only (maxX=400, Y=0)
  assert.deepEqual(clampPan(500, 300, 2, 800, 1280, 800, 450), {
    x: 400,
    y: 0,
  });
});

test('computeFocalPan anchors content point under pinch midpoint [M5]', () => {
  const anchored = computeFocalPan(0, 0, 1, 2, 300, 0, 0, 0);
  assert.deepEqual(anchored, { x: -300, y: 0 });
  const drifted = computeFocalPan(0, 0, 1, 2, 300, -100, 15, -5);
  assert.deepEqual(drifted, { x: -285, y: 95 });
});

test('portrait letterbox locks Y and rotation reclamps zoom [N2, N4]', () => {
  const draw = computeDrawSize(1280, 544, 412, 915, 0);
  close(draw.drawWidth, 412);
  close(draw.drawHeight, 175.1);
  assert.deepEqual(
    clampPan(100, 100, 2, 412, 915, draw.drawWidth, draw.drawHeight),
    { x: 100, y: 0 },
  );
  assert.equal(snapPinchScale(4.5, 5.226), 4.5);
  assert.equal(clampScale(5.2, computeMaxScale(1.059)), 4);

  const stage = { getBoundingClientRect: () => ({ width: 412, height: 915 }) };
  const video = {
    videoWidth: 1280,
    videoHeight: 544,
    style: { setProperty: () => {} },
  };
  const visuals = createVisuals(video, stage);
  visuals.beginPinch();
  visuals.pinchTo(5);
  visuals.endPinch();
  close(visuals.getScale(), 5);
  visuals.rotateQuarter();
  assert.equal(visuals.getScale(), 4);
});
