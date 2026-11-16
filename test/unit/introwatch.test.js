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

test('canListen bypasses file:// URLs to prevent WebAudio silence [D1]', () => {
  const fileVideo = {
    currentSrc: 'file:///videos/episode.mp4',
    srcObject: null,
    crossOrigin: null,
  };
  assert.equal(canListen(fileVideo, FILE_LOC), false);
  const withCors = { ...fileVideo, crossOrigin: 'anonymous' };
  assert.equal(canListen(withCors, FILE_LOC), false);
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
