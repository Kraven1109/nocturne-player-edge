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
      pinchMove: record('pinchMove'),
      pinchEnd: record('pinchEnd'),
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

test('canPan prioritizes 1-finger pan across zones over swipe/seek', () => {
  for (const [x, y] of [
    [0.5, 0.5],
    [0.2, 0.5],
    [0.8, 0.8],
  ]) {
    const { events, surface } = setUp({
      canPan: () => true,
      canSwipe: () => true,
      canVerticalDrag: () => true,
    });
    surface.fire('pointerdown', x, y);
    surface.fire('pointermove', x + 0.05, y + 0.05);
    surface.fire('pointerup', x + 0.05, y + 0.05);
    assert.deepEqual(
      events.map((e) => [e.name, e.axis]),
      [
        ['dragStart', 'pan'],
        ['dragMove', 'pan'],
        ['dragEnd', 'pan'],
      ],
    );
    mock.timers.reset();
  }
});

test('pan preserves H1 idempotency and H2 lock + pinch emits midpoint', () => {
  let panEnabled = true;
  const h2 = setUp({ canPan: () => panEnabled });
  h2.surface.fire('pointerdown', 0.5, 0.5, 1);
  h2.surface.fire('pointermove', 0.55, 0.5, 1);
  panEnabled = false;
  h2.surface.fire('pointermove', 0.6, 0.5, 1);
  h2.surface.fire('pointercancel', 0.6, 0.5, 1);
  h2.surface.fire('lostpointercapture', 0.6, 0.5, 1);
  assert.deepEqual(
    h2.events.map((e) => [e.name, e.axis]),
    [
      ['dragStart', 'pan'],
      ['dragMove', 'pan'],
      ['dragMove', 'pan'],
      ['dragEnd', 'pan'],
    ],
  );
  mock.timers.reset();

  const pinch = setUp({ canPan: () => true });
  pinch.surface.fire('pointerdown', 0.4, 0.5, 1);
  pinch.surface.fire('pointerdown', 0.6, 0.5, 2);
  pinch.surface.fire('pointermove', 0.35, 0.5, 1);
  pinch.surface.fire('pointermove', 0.65, 0.5, 2);
  const moves = pinch.events.filter((e) => e.name === 'pinchMove');
  assert.equal(moves.length, 2);
  assert.ok(moves[1].scale > 1);
  assert.equal(Math.round(moves[0].dx + moves[1].dx), 0);
  mock.timers.reset();
});

test('pinch bounce and pointercancel stay abandoned until reset', () => {
  const { events, surface } = setUp({ canPan: () => true });
  surface.fire('pointerdown', 0.4, 0.5, 1);
  surface.fire('pointerdown', 0.6, 0.5, 2);
  surface.fire('pointerup', 0.6, 0.5, 2);
  // Stray finger bounce while the first finger is still held must not
  // restart a new pinch mid-release.
  surface.fire('pointerdown', 0.62, 0.5, 3);
  surface.fire('pointermove', 0.75, 0.5, 3);
  surface.fire('pointerup', 0.62, 0.5, 3);
  surface.fire('pointerup', 0.4, 0.5, 1);
  mock.timers.runAll();

  assert.equal(events.filter((e) => e.name === 'pinchStart').length, 1);
  assert.equal(events.filter((e) => e.name === 'pinchMove').length, 0);
  assert.equal(events.filter((e) => e.name === 'pinchEnd').length, 1);
  assert.equal(events.filter((e) => e.name === 'tap').length, 0);

  // Cancel path clears PINCH into ABANDONED cleanly with a single pinchEnd.
  surface.fire('pointerdown', 0.4, 0.5, 4);
  surface.fire('pointerdown', 0.6, 0.5, 5);
  surface.fire('pointercancel', 0.6, 0.5, 5);
  surface.fire('pointermove', 0.5, 0.5, 4);
  surface.fire('pointerup', 0.5, 0.5, 4);
  mock.timers.runAll();

  assert.equal(events.filter((e) => e.name === 'pinchStart').length, 2);
  assert.equal(events.filter((e) => e.name === 'pinchEnd').length, 2);
  assert.equal(events.filter((e) => e.name === 'tap').length, 0);
  mock.timers.reset();
});

test('pinch keeps original pair IDs and ignores capture throw', () => {
  const { events, surface } = setUp();
  surface.setPointerCapture = () => {
    throw new DOMException('detached', 'NotFoundError');
  };
  surface.fire('pointerdown', 0.4, 0.5, 10);
  surface.fire('pointerdown', 0.6, 0.5, 11);
  surface.fire('pointerdown', 0.9, 0.9, 12);
  surface.fire('pointermove', 0.3, 0.5, 10);
  const moves = events.filter((e) => e.name === 'pinchMove');
  assert.equal(moves.length, 1);
  // Distance went from 0.2*WIDTH to 0.3*WIDTH between pointers 10 & 11.
  assert.equal(Math.round(moves[0].scale * 10) / 10, 1.5);
  mock.timers.reset();
});
