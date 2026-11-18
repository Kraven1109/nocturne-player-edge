/* eslint-disable no-invalid-this */
/* global getComputedStyle */
import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path, { join, resolve } from 'node:path';
import { chromium, devices } from 'playwright-core';

const DIST_DIR = resolve('dist');
const FIXTURES_ROOT = resolve('test/fixtures');
const PORT = 8441;

const HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;background:#000}video{width:100%;height:240px}</style>
</head><body>
<video src="/sample.mp4" preload="auto" muted playsinline loop></video>
</body></html>`;

const startServer = () =>
  new Promise((ok) => {
    const server = createServer(async (req, res) => {
      const p = new URL(req.url, 'http://x').pathname;
      if (p === '/pinch.html') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(HTML);
        return;
      }
      const file = join(FIXTURES_ROOT, p);
      try {
        const info = await stat(file);
        const range = req.headers.range;
        if (range) {
          const [a, b] = range.replace('bytes=', '').split('-');
          const start = Number(a);
          const end = b ? Number(b) : info.size - 1;
          res.writeHead(206, {
            'content-type': 'video/mp4',
            'accept-ranges': 'bytes',
            'content-range': `bytes ${start}-${end}/${info.size}`,
            'content-length': end - start + 1,
          });
          createReadStream(file, { start, end }).pipe(res);
        } else {
          res.writeHead(200, {
            'content-type': 'video/mp4',
            'accept-ranges': 'bytes',
            'content-length': info.size,
          });
          createReadStream(file).pipe(res);
        }
      } catch {
        res.writeHead(404).end();
      }
    });
    server.listen(PORT, '127.0.0.1', () => ok(server));
  });

const inShadow = async (cdp, fn) => {
  const { root } = await cdp.send('DOM.getDocument', { depth: 1 });
  const { nodeId } = await cdp.send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: '[data-nocturne-player] > [data-nocturne]',
  });
  const { node } = await cdp.send('DOM.describeNode', {
    nodeId,
    depth: 2,
    pierce: true,
  });
  const { object } = await cdp.send('DOM.resolveNode', {
    backendNodeId: node.shadowRoots[0].backendNodeId,
  });
  const { result, exceptionDetails } = await cdp.send(
    'Runtime.callFunctionOn',
    {
      objectId: object.objectId,
      functionDeclaration: fn.toString(),
      returnByValue: true,
    },
  );
  if (exceptionDetails) throw new Error(JSON.stringify(exceptionDetails));
  return result.value;
};

const parseScale = (transform) => {
  if (!transform || transform === 'none') return 1;
  const m = transform.match(/matrix\(([^,]+),/);
  return m ? Number(m[1]) : 1;
};

const parseTranslateX = (transform) => {
  if (!transform || transform === 'none') return 0;
  const parts = transform.match(/matrix\(([^)]+)\)/)?.[1].split(',');
  return parts ? Number(parts[4]) : 0;
};

const run = async () => {
  const server = await startServer();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-pinch-'));
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    channel: 'msedge',
    headless: true,
    ...devices['Pixel 7'],
    args: [
      `--disable-extensions-except=${DIST_DIR}`,
      `--load-extension=${DIST_DIR}`,
      '--no-first-run',
      '--autoplay-policy=no-user-gesture-required',
    ],
    env: { ...process.env, HOME: '/tmp', XDG_CONFIG_HOME: '/tmp' },
  });

  try {
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('DOM.enable');
    await page.goto(`http://127.0.0.1:${PORT}/pinch.html`, {
      waitUntil: 'load',
    });
    await page.waitForFunction(
      () => document.querySelector('video')?.videoWidth > 0,
    );
    await page.waitForSelector('[data-nocturne]');

    const vRect = await page.evaluate(() =>
      document.querySelector('video').getBoundingClientRect().toJSON(),
    );
    await page.touchscreen.tap(
      vRect.x + vRect.width / 2,
      vRect.y + vRect.height / 2,
    );
    await page.waitForFunction(
      () =>
        document.querySelector('[data-nocturne]')?.dataset.revealed === 'true',
    );
    const box = await page.evaluate(() =>
      document
        .querySelector('[data-nocturne]')
        .getBoundingClientRect()
        .toJSON(),
    );
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForSelector('[data-nocturne-player]');
    await page.evaluate(() => document.querySelector('video').pause());
    await page.waitForTimeout(250);

    // 1. Light-DOM & stylesheet rule check (R1)
    const rootInfo = await page.evaluate(() => {
      const v = document.querySelector('video');
      const st = document.querySelector('[data-nocturne-player]');
      const css = st.querySelector(
        'style[data-nocturne-stage-style]',
      )?.textContent;
      return {
        isDocRoot: v.getRootNode() === document,
        hasRule: Boolean(css?.includes('[data-nocturne-player] > video')),
      };
    });
    assert.deepEqual(rootInfo, { isDocRoot: true, hasRule: true });
    console.log('ok  R1 light-DOM video + STAGE_CSS !important rule verified');

    const touch = (type, pts) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: pts.map(([id, x, y]) => ({
          id,
          x,
          y,
          radiusX: 12,
          radiusY: 12,
        })),
      });

    // 2. Pinch directly over visible .play-button (P1 + R2)
    const pb = await inShadow(cdp, function () {
      return this.querySelector('.play-button')
        .getBoundingClientRect()
        .toJSON();
    });
    const px = pb.x + pb.width / 2;
    const py = pb.y + pb.height / 2;
    await touch('touchStart', [[1, px, py]]);
    await touch('touchStart', [
      [1, px, py],
      [2, px + 70, py],
    ]);
    await touch('touchMove', [
      [1, px - 40, py],
      [2, px + 110, py],
    ]);
    await page.waitForTimeout(40);
    const s1 = await page.evaluate(
      () => getComputedStyle(document.querySelector('video')).transform,
    );
    assert.ok(parseScale(s1) > 1.8, `expected scale > 1.8, got ${s1}`);
    assert.equal(
      await page.evaluate(() => document.querySelector('video').paused),
      true,
      'pinch over Play must not toggle playback',
    );
    console.log('ok  P1+R2 pinch over .play-button scaled smoothly');

    // 3. Lift finger 2, put back >=12px away -> continue pinch (P2)
    await touch('touchEnd', [[1, px - 40, py]]);
    await page.waitForTimeout(40);
    await touch('touchStart', [
      [1, px - 40, py],
      [3, px + 40, py],
    ]);
    await touch('touchMove', [
      [1, px - 80, py],
      [3, px + 80, py],
    ]);
    await page.waitForTimeout(40);
    const s2 = await page.evaluate(
      () => getComputedStyle(document.querySelector('video')).transform,
    );
    assert.ok(parseScale(s2) > 2.2, `re-pinch expected > 2.2, got ${s2}`);
    console.log('ok  P2 re-pinch after 1-finger lift keeps climbing');

    // 4. Resize mid-pinch defers relayout, then release holds scale (P3)
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await page.waitForTimeout(40);
    const duringResize = await page.evaluate(
      () => getComputedStyle(document.querySelector('video')).transform,
    );
    assert.ok(parseScale(duringResize) > 2.2);
    await touch('touchEnd', []);
    await page.waitForTimeout(80);
    const afterRelease = await page.evaluate(
      () => getComputedStyle(document.querySelector('video')).transform,
    );
    assert.ok(parseScale(afterRelease) > 2.2);
    console.log('ok  P3 deferred relayout and release hold verified');

    // 5. Valid tap on Play immediately after pinch toggles playback (R4)
    await page.touchscreen.tap(px, py);
    await page.waitForTimeout(100);
    assert.equal(
      await page.evaluate(() => document.querySelector('video').paused),
      false,
      'tap on Play right after pinch must toggle playback',
    );
    console.log('ok  R4 Play tap after pinch works cleanly');

    // 6. Site style rewrite + burst !important stress test (P4)
    const afterFight = await page.evaluate(async () => {
      const v = document.querySelector('video');
      for (let i = 0; i < 650; i++) {
        v.style.cssText = 'width:120px;transform:scale(1);';
      }
      await new Promise((r) => {
        setTimeout(r, 40);
      });
      v.style.setProperty('transform', 'scale(1)', 'important');
      await new Promise((r) => {
        setTimeout(r, 40);
      });
      return getComputedStyle(v).transform;
    });
    assert.ok(
      parseScale(afterFight) > 2.2,
      `styleGuard must hold transform, got ${afterFight}`,
    );
    console.log('ok  P4 CSS cascade + styleGuard survives >650 writes');

    // 7. Blur reset mid-pinch clears gesture locks and allows resize relayout
    await touch('touchStart', [[4, 150, 300]]);
    await touch('touchStart', [
      [4, 150, 300],
      [5, 250, 300],
    ]);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('blur'));
      window.dispatchEvent(new Event('resize'));
    });
    await page.waitForTimeout(80);
    const afterBlur = await page.evaluate(
      () => getComputedStyle(document.querySelector('video')).transform,
    );
    assert.ok(parseScale(afterBlur) > 2.2);
    console.log('ok  R5 blur reset mid-pinch flushes cleanly');

    // 8. Laptop touchpad Ctrl+wheel pinch, Arrow pan, and .zoom-reset pill
    await page.keyboard.press('0');
    await page.waitForTimeout(320);
    const resetViaKey = await page.evaluate(
      () => getComputedStyle(document.querySelector('video')).transform,
    );
    assert.equal(resetViaKey, 'none');

    await page.mouse.move(200, 300);
    await page.keyboard.down('Control');
    for (let i = 0; i < 3; i++) {
      await page.mouse.wheel(0, -80);
    }
    await page.keyboard.up('Control');
    await page.waitForTimeout(240);
    const afterWheel = await page.evaluate(
      () => getComputedStyle(document.querySelector('video')).transform,
    );
    assert.ok(
      parseScale(afterWheel) > 1.5,
      `expected Ctrl+wheel scale > 1.5, got ${afterWheel}`,
    );

    const zr = await inShadow(cdp, function () {
      const btn = this.querySelector('.zoom-reset');
      const surf = this.querySelector('.surface');
      return {
        hidden: btn.classList.contains('is-hidden'),
        text: btn.textContent,
        zoomed: surf.classList.contains('is-zoomed'),
        rect: btn.getBoundingClientRect().toJSON(),
      };
    });
    assert.equal(zr.hidden, false);
    assert.equal(zr.zoomed, true);
    assert.ok(zr.text.includes('×'));

    const txBefore = parseTranslateX(afterWheel);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(40);
    const afterArrow = await page.evaluate(
      () => getComputedStyle(document.querySelector('video')).transform,
    );
    assert.ok(
      parseTranslateX(afterArrow) < txBefore,
      `expected ArrowRight shift: ${txBefore} -> ${afterArrow}`,
    );

    await page.mouse.click(
      zr.rect.x + zr.rect.width / 2,
      zr.rect.y + zr.rect.height / 2,
    );
    await page.waitForTimeout(320);
    const afterPillReset = await page.evaluate(
      () => getComputedStyle(document.querySelector('video')).transform,
    );
    assert.equal(afterPillReset, 'none');
    const zrAfter = await inShadow(cdp, function () {
      return {
        hidden:
          this.querySelector('.zoom-reset').classList.contains('is-hidden'),
        zoomed: this.querySelector('.surface').classList.contains('is-zoomed'),
      };
    });
    assert.deepEqual(zrAfter, { hidden: true, zoomed: false });
    console.log('ok  desktop touchpad pinch, Arrow pan, and reset pill pass');
  } finally {
    await ctx.close();
    server.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
};

run().then(
  () => console.log('ALL OK'),
  (e) => {
    console.error('FAIL', e);
    process.exit(1);
  },
);
