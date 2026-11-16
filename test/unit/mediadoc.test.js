import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  isMediaDocumentSupported,
  isPlayable,
  resolveHostKey,
} from '../../src/content/detect.js';

test('isMediaDocumentSupported allows web, file, content [D4]', () => {
  for (const proto of ['http:', 'https:', 'file:', 'content:']) {
    assert.equal(isMediaDocumentSupported('text/html', proto), true);
    assert.equal(isMediaDocumentSupported('video/mp4', proto), true);
    assert.equal(isMediaDocumentSupported('video/webm', proto), true);
  }
});

test('isMediaDocumentSupported rejects non-web schemes [D4]', () => {
  for (const proto of [
    'about:',
    'data:',
    'blob:',
    'chrome-extension:',
    'moz-extension:',
    'edge:',
  ]) {
    assert.equal(isMediaDocumentSupported('text/html', proto), false);
    assert.equal(isMediaDocumentSupported('video/mp4', proto), false);
  }
});

test('isMediaDocumentSupported rejects unsupported MIME types and null', () => {
  assert.equal(isMediaDocumentSupported('application/pdf', 'https:'), false);
  assert.equal(isMediaDocumentSupported('application/ogg', 'file:'), false);
  assert.equal(isMediaDocumentSupported(null, 'https:'), false);
  assert.equal(isMediaDocumentSupported('', 'https:'), false);
});

test('resolveHostKey maps file:/content: and keeps http/https hosts', () => {
  assert.equal(resolveHostKey('file:', ''), 'file:');
  assert.equal(resolveHostKey('content:', ''), 'content:');
  assert.equal(resolveHostKey('https:', 'example.com'), 'example.com');
  assert.equal(resolveHostKey('http:', '127.0.0.1:8422'), '127.0.0.1:8422');
});

test('isPlayable silently rejects loaded 0x0 audio-only video elements', () => {
  const prevGetComputedStyle = globalThis.getComputedStyle;
  globalThis.getComputedStyle = () => ({
    visibility: 'visible',
    display: 'block',
    opacity: '1',
  });
  try {
    const base = {
      isConnected: true,
      readyState: 1,
      currentSrc: 'file:///audio_only.mp4',
      getBoundingClientRect: () => ({ width: 300, height: 150 }),
    };
    assert.equal(isPlayable({ ...base, videoWidth: 0, videoHeight: 0 }), false);
    assert.equal(
      isPlayable({ ...base, videoWidth: 1280, videoHeight: 544 }),
      true,
    );
  } finally {
    globalThis.getComputedStyle = prevGetComputedStyle;
  }
});
