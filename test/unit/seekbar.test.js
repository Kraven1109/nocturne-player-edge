import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  clampPreviewPercent,
  clampRatio,
  fitThumb,
  ratioFromPointer,
} from '../../src/content/controls/seekbar.js';

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

test('clampPreviewPercent keeps thumbnail card away from track edges', () => {
  assert.equal(clampPreviewPercent(0), 8);
  assert.equal(clampPreviewPercent(0.5), 50);
  assert.equal(clampPreviewPercent(1), 92);
});

test('fitThumb keeps the video aspect ratio inside the box', () => {
  assert.deepEqual(fitThumb(1280, 544), { width: 160, height: 68 });
  assert.deepEqual(fitThumb(1920, 1080), { width: 160, height: 90 });
  assert.deepEqual(fitThumb(1080, 1920), { width: 51, height: 90 });
  assert.deepEqual(fitThumb(0, 0), { width: 160, height: 90 });
});
