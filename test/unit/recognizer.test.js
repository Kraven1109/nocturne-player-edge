import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';

import { createRecognizer } from '../../src/content/gestures/recognizer.js';

const WIDTH = 800;
const HEIGHT = 360;

const createSurface = () => {
  const listeners = new Map();
  return {
    addEventListener: (type, handler) => listeners.set(type, handler),
    removeEventListener: (type) => listeners.delete(type),
    setPointerCapture: () => {},
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: WIDTH,
      height: HEIGHT,
    }),
    fire: (type, xRatio, yRatio, pointerId = 1) =>
      listeners.get(type)?.({
        pointerId,
        clientX: xRatio * WIDTH,
        clientY: yRatio * HEIGHT,
      }),
  };
};

const setUp = (options = {}) => {
  const surface = createSurface();
  const events = [];
  const record = (name) => (detail) => events.push({ name, ...detail });
  createRecognizer(
    surface,
    {
      tap: record('tap'),
      multiTap: record('multiTap'),
      holdStart: record('holdStart'),
      holdEnd: record('holdEnd'),
      dragStart: record('dragStart'),
      dragMove: record('dragMove'),
      dragEnd: record('dragEnd'),
      pinchStart: record('pinchStart'),
      swipe: record('swipe'),
    },
    options,
  );
  const tapAt = (xRatio, yRatio) => {
    surface.fire('pointerdown', xRatio, yRatio);
    surface.fire('pointerup', xRatio, yRatio);
  };
  return { surface, events, tapAt };
};

beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout'] });
});

test('a lone tap on a side waits for a second before showing controls', () => {
  const { events, tapAt } = setUp();
  tapAt(0.8, 0.4);
  assert.deepEqual(events, []);
  mock.timers.tick(400);
  assert.deepEqual(
    events.map((event) => event.name),
    ['tap'],
  );
  mock.timers.reset();
});

test('a tap in the middle acts at once, so a second tap can pause', () => {
  const { events, tapAt } = setUp();
  tapAt(0.5, 0.4);
  tapAt(0.5, 0.4);
  assert.deepEqual(
    events.map((event) => event.name),
    ['tap', 'tap'],
  );
  mock.timers.reset();
});

test('a double-tap that is not very quick still seeks, never toggles', () => {
  const { events, tapAt } = setUp();
  tapAt(0.8, 0.4);
  mock.timers.tick(280);
  tapAt(0.84, 0.46);
  mock.timers.tick(1000);
  assert.deepEqual(
    events.map((event) => [event.name, event.zone]),
    [['multiTap', 'holdRight']],
  );
  mock.timers.reset();
});

test('a second tap that strays onto the middle still seeks', () => {
  const { events, tapAt } = setUp();
  tapAt(0.7, 0.4);
  mock.timers.tick(200);
  tapAt(0.55, 0.4);
  mock.timers.tick(1000);
  assert.deepEqual(
    events.map((event) => [event.name, event.zone]),
    [['multiTap', 'holdRight']],
  );
  mock.timers.reset();
});

test('holding a side reports the start and the end of the hold', () => {
  const { events, surface } = setUp();
  surface.fire('pointerdown', 0.8, 0.4);
  mock.timers.tick(400);
  surface.fire('pointerup', 0.8, 0.4);
  assert.deepEqual(
    events.map((event) => [event.name, event.zone]),
    [
      ['holdStart', 'holdRight'],
      ['holdEnd', 'holdRight'],
    ],
  );
  mock.timers.reset();
});

test('vertical side drag stays off when canVerticalDrag() is false', () => {
  const { events, surface } = setUp({ canVerticalDrag: () => false });
  surface.fire('pointerdown', 0.2, 0.5);
  surface.fire('pointermove', 0.2, 0.3);
  surface.fire('pointerup', 0.2, 0.3);
  assert.deepEqual(events, []);
  mock.timers.reset();
});

test('vertical drag emits cumulative totalDy on left and right sides', () => {
  const { events, surface } = setUp({ canVerticalDrag: () => true });
  surface.fire('pointerdown', 0.2, 0.5);
  surface.fire('pointermove', 0.2, 0.3);
  surface.fire('pointermove', 0.2, 0.2);
  surface.fire('pointerup', 0.2, 0.2);

  assert.deepEqual(
    events.map((e) => [e.name, e.zone, e.axis]),
    [
      ['dragStart', 'holdLeft', 'vertical'],
      ['dragMove', 'holdLeft', 'vertical'],
      ['dragMove', 'holdLeft', 'vertical'],
      ['dragEnd', 'holdLeft', 'vertical'],
    ],
  );
  assert.equal(Math.round(events[2].totalDy), Math.round(-0.3 * HEIGHT));
  mock.timers.reset();
});

test('canSwipe preempts vertical drag; horizontal side drag abandoned', () => {
  const swiping = setUp({
    canSwipe: () => true,
    canVerticalDrag: () => true,
  });
  swiping.surface.fire('pointerdown', 0.8, 0.5);
  swiping.surface.fire('pointermove', 0.8, 0.2);
  swiping.surface.fire('pointerup', 0.8, 0.2);
  assert.equal(swiping.events.filter((e) => e.name === 'dragStart').length, 0);
  assert.equal(swiping.events.filter((e) => e.name === 'swipe').length, 1);

  const horiz = setUp({ canVerticalDrag: () => true });
  horiz.surface.fire('pointerdown', 0.2, 0.5);
  horiz.surface.fire('pointermove', 0.4, 0.5);
  horiz.surface.fire('pointerup', 0.4, 0.5);
  assert.deepEqual(horiz.events, []);
  mock.timers.reset();
});

test('locked vertical drag finishes even if setting flips false [H2]', () => {
  let enabled = true;
  const { events, surface } = setUp({ canVerticalDrag: () => enabled });
  surface.fire('pointerdown', 0.8, 0.5);
  surface.fire('pointermove', 0.8, 0.4);
  enabled = false;
  surface.fire('pointermove', 0.8, 0.3);
  surface.fire('pointerup', 0.8, 0.3);
  assert.deepEqual(
    events.map((e) => e.name),
    ['dragStart', 'dragMove', 'dragMove', 'dragEnd'],
  );
  mock.timers.reset();
});

test('dragEnd idempotency H1: pointerup + lostpointercapture -> once', () => {
  const { events, surface } = setUp({ canVerticalDrag: () => true });
  surface.fire('pointerdown', 0.8, 0.5);
  surface.fire('pointermove', 0.8, 0.3);
  surface.fire('pointerup', 0.8, 0.3);
  surface.fire('lostpointercapture', 0.8, 0.3);
  assert.equal(events.filter((e) => e.name === 'dragEnd').length, 1);
  mock.timers.reset();
});

test('dragEnd idempotency H1: pointercancel + lostcapture -> once', () => {
  const { events, surface } = setUp({ canVerticalDrag: () => true });
  surface.fire('pointerdown', 0.8, 0.5);
  surface.fire('pointermove', 0.8, 0.3);
  surface.fire('pointercancel', 0.8, 0.3);
  surface.fire('lostpointercapture', 0.8, 0.3);
  assert.equal(events.filter((e) => e.name === 'dragEnd').length, 1);
  mock.timers.reset();
});

test('dragEnd idempotency H1: pinchStart mid-drag -> once', () => {
  const { events, surface } = setUp({ canVerticalDrag: () => true });
  surface.fire('pointerdown', 0.8, 0.5, 1);
  surface.fire('pointermove', 0.8, 0.3, 1);
  surface.fire('pointerdown', 0.2, 0.5, 2);
  surface.fire('pointerup', 0.8, 0.3, 1);
  surface.fire('lostpointercapture', 0.8, 0.3, 1);
  surface.fire('pointerup', 0.2, 0.5, 2);
  surface.fire('lostpointercapture', 0.2, 0.5, 2);
  assert.equal(events.filter((e) => e.name === 'dragEnd').length, 1);
  assert.equal(events.filter((e) => e.name === 'pinchStart').length, 1);
  mock.timers.reset();
});
