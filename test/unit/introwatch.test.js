import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canListen } from '../../src/content/video/introwatch.js';

const FILE_LOC = {
  protocol: 'file:',
  origin: 'file://',
  href: 'file:///videos/episode.mp4',
};

const HTTP_LOC = {
  protocol: 'http:',
  origin: 'http://127.0.0.1:8422',
  href: 'http://127.0.0.1:8422/film.html',
};

test('canListen bypasses file:, content:, and chrome-extension: [D1]', () => {
  const fileVideo = {
    currentSrc: 'file:///videos/episode.mp4',
    srcObject: null,
    crossOrigin: null,
  };
  assert.equal(canListen(fileVideo, FILE_LOC), false);
  const withCors = { ...fileVideo, crossOrigin: 'anonymous' };
  assert.equal(canListen(withCors, FILE_LOC), false);

  const contentLoc = {
    protocol: 'content:',
    origin: 'null',
    href: 'content://media/external/downloads/100',
  };
  const contentVideo = {
    currentSrc: 'content://media/external/downloads/100',
    srcObject: null,
    crossOrigin: null,
  };
  assert.equal(canListen(contentVideo, contentLoc), false);

  const extLoc = {
    protocol: 'chrome-extension:',
    origin: 'chrome-extension://abcdefghijklmnop',
    href: 'chrome-extension://abcdefghijklmnop/local.html',
  };
  const blobInExt = {
    currentSrc: 'blob:chrome-extension://abcdefghijklmnop/123',
    srcObject: null,
    crossOrigin: null,
  };
  assert.equal(canListen(blobInExt, extLoc), false);
});

test('canListen allows same-origin or CORS HTTP media only', () => {
  const sameOrigin = {
    currentSrc: 'http://127.0.0.1:8422/sample.mp4',
    srcObject: null,
    crossOrigin: null,
  };
  assert.equal(canListen(sameOrigin, HTTP_LOC), true);

  const crossOriginNoCors = {
    currentSrc: 'https://cdn.example.net/sample.mp4',
    srcObject: null,
    crossOrigin: null,
  };
  assert.equal(canListen(crossOriginNoCors, HTTP_LOC), false);

  const crossOriginWithCors = {
    currentSrc: 'https://cdn.example.net/sample.mp4',
    srcObject: null,
    crossOrigin: 'anonymous',
  };
  assert.equal(canListen(crossOriginWithCors, HTTP_LOC), true);
});
