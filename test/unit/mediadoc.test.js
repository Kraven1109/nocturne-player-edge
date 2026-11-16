import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  isMediaDocumentSupported,
  resolveHostKey,
} from '../../src/content/detect.js';

test('isMediaDocumentSupported allows http/https/file web & video [D4]', () => {
  for (const proto of ['http:', 'https:', 'file:']) {
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

test('resolveHostKey maps file: to "file:" and keeps http/https hosts', () => {
  assert.equal(resolveHostKey('file:', ''), 'file:');
  assert.equal(resolveHostKey('https:', 'example.com'), 'example.com');
  assert.equal(resolveHostKey('http:', '127.0.0.1:8422'), '127.0.0.1:8422');
});
