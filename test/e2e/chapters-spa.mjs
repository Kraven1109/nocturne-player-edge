// Usage: node test/e2e/chapters-spa.mjs          (local fixture)
//        node test/e2e/chapters-spa.mjs --live   (real youtube.com)
//        node test/e2e/chapters-spa.mjs --mobile (real m.youtube.com)
/* eslint-disable no-invalid-this */
import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import fs from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path, { join, resolve } from 'node:path';
import { chromium, devices } from 'playwright-core';

const DIST_DIR = resolve('dist');
const FIXTURES_ROOT = resolve('test/fixtures');
const PORT = 8437;
const MOBILE = process.argv.includes('--mobile');
const LIVE = process.argv.includes('--live') || MOBILE;
const HOST = MOBILE ? 'm.youtube.com' : 'www.youtube.com';

const SIM = `<!doctype html><html><head><meta charset="utf-8">
<title>sim</title>
<style>
body { margin: 0; }
#movie_player { width: 640px; height: 360px; }
video { width: 640px; height: 360px; display: block; }
</style></head>
<body>
<ytd-watch-flexy></ytd-watch-flexy>
<div id="movie_player">
  <video src="/sample.mp4?A" preload="auto" loop muted></video>
</div>
<script>
  const mk = (...starts) =>
    starts.map((s, i) => ({
      chapterRenderer: {
        title: { simpleText: 'Ch' + i + '@' + s },
        timeRangeStartMillis: s * 1000,
      },
    }));
  const CH = { A: mk(0, 1, 2), B: mk(0, 1.5), C: [], D: mk(0, 1) };
  const watch = (id) => ({
    currentVideoEndpoint: { watchEndpoint: { videoId: id } },
    playerOverlays: { playerOverlayRenderer: { markers: CH[id] } },
  });
  const player = document.getElementById('movie_player');
  const video = document.querySelector('video');
  const flexy = document.querySelector('ytd-watch-flexy');
  let liveId = new URL(location.href).searchParams.get('v') || 'A';
  history.replaceState({}, '', '/yt.html?v=' + liveId);
  player.getAvailableQualityLevels = () => [];
  player.getPlayerResponse = () => ({ videoDetails: { videoId: liveId } });
  player.getVideoData = () => ({ video_id: liveId });
  flexy.data = watch(liveId);
  window.ytInitialData = watch(liveId);
  window.__ad = (on) => player.classList.toggle('ad-showing', on);
  window.__quality = () => {
    video.src = '/sample.mp4?q' + Math.random();
  };
  window.__nav = (id) => {
    history.pushState({}, '', '/yt.html?v=' + id);
    liveId = id;
    video.src = '/sample.mp4?' + id;
    setTimeout(() => {
      flexy.data = watch(id);
    }, 900);
  };
</script></body></html>`;

const startServer = () =>
  new Promise((ok) => {
    const server = createServer(async (req, res) => {
      const p = new URL(req.url, 'http://x').pathname;
      if (p === '/yt.html') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(SIM);
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

const clickBadge = async (page) => {
  await page.waitForSelector('[data-nocturne]');
  const vRect = await page.evaluate(() =>
    document.querySelector('video').getBoundingClientRect().toJSON(),
  );
  const cx = vRect.x + vRect.width / 2;
  const cy = vRect.y + vRect.height / 2;
  if (MOBILE) {
    const isRevealed = await page.evaluate(
      () =>
        document.querySelector('[data-nocturne]')?.dataset.revealed === 'true',
    );
    if (!isRevealed) await page.touchscreen.tap(cx, cy);
  } else {
    await page.mouse.move(cx, cy);
  }
  await page.waitForFunction(
    () =>
      document.querySelector('[data-nocturne]')?.dataset.revealed === 'true',
    null,
    { timeout: 2000 },
  );
  const box = await page.evaluate(() =>
    document.querySelector('[data-nocturne]').getBoundingClientRect().toJSON(),
  );
  if (MOBILE) {
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  } else {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }
  await page.waitForSelector('[data-nocturne-player]');
};

const inShadow = async (cdp, fn, arg) => {
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
      arguments: arg !== undefined ? [{ value: arg }] : [],
      awaitPromise: true,
      returnByValue: true,
    },
  );
  if (exceptionDetails) throw new Error(JSON.stringify(exceptionDetails));
  return result.value;
};

// Polls the dividers for `ms`, returning the series of counts seen.
const watchMarks = (cdp, ms, action) =>
  inShadow(
    cdp,
    async function (arg) {
      const [duration, code] = arg;
      const series = [];
      if (code) new Function(code)();
      const t0 = performance.now();
      while (performance.now() - t0 < duration) {
        const n = this.querySelectorAll('.seek-mark').length;
        if (series[series.length - 1] !== n) series.push(n);
        await new Promise((r) => {
          setTimeout(r, 25);
        });
      }
      return series;
    },
    [ms, action ?? ''],
  );

const marksNow = (cdp) =>
  inShadow(cdp, function () {
    return this.querySelectorAll('.seek-mark').length;
  });

const run = async () => {
  const server = LIVE ? null : await startServer();
  const deviceArgs = MOBILE ? devices['Pixel 7'] : {};
  const ctx = await chromium.launchPersistentContext(
    fs.mkdtempSync(path.join(os.tmpdir(), 'edge-chs-')),
    {
      channel: 'msedge',
      headless: true,
      ...deviceArgs,
      args: [
        `--disable-extensions-except=${DIST_DIR}`,
        `--load-extension=${DIST_DIR}`,
        '--no-first-run',
        '--autoplay-policy=no-user-gesture-required',
      ],
      env: { ...process.env, HOME: '/tmp', XDG_CONFIG_HOME: '/tmp' },
    },
  );
  try {
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('DOM.enable');
    if (LIVE) {
      await page.goto(`https://${HOST}/watch?v=aircAruvnKk`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForSelector('video');
      await page.waitForTimeout(4000);
      await clickBadge(page);
      // Pre-roll ads may run first; chapters must arrive once the film does.
      let n = 0;
      for (let i = 0; i < 30 && n === 0; i++) {
        await page.waitForTimeout(1000);
        n = await marksNow(cdp);
      }
      console.log('live: dividers after load', n);
      assert.ok(n > 0);
      const navCode =
        `[...document.querySelectorAll('a[href^="/watch?v="]')].find((a) => ` +
        `!a.href.includes('aircAruvnKk')).click()`;
      const series = await watchMarks(cdp, 50000, navCode);
      console.log(
        'live: after SPA navigation',
        JSON.stringify(series),
        page.url().slice(-11),
      );
      assert.notEqual(page.url().slice(-11), 'aircAruvnKk');
      // Chapters of the next video appear once its pre-roll ad is over.
      let after = 0;
      for (let i = 0; i < 90 && after === 0; i++) {
        await page.waitForTimeout(1000);
        after = await marksNow(cdp);
      }
      console.log('live: dividers of the next video', after);
      assert.ok(after > 0, 'next video chapters must appear');
      const adShowing = await page.evaluate(() =>
        document
          .querySelector('#movie_player')
          ?.classList.contains('ad-showing'),
      );
      const vidDur = await page.evaluate(
        () => document.querySelector('video').duration,
      );
      console.log('live: ad showing at end', adShowing, 'dur', vidDur);
      return;
    }

    await page.goto(`http://127.0.0.1:${PORT}/yt.html?v=A`, {
      waitUntil: 'load',
    });
    await page.waitForTimeout(800);
    await clickBadge(page);
    await page.waitForTimeout(2000);
    assert.equal(await marksNow(cdp), 2, 'A: two dividers');
    console.log('ok  first video shows its chapters (2)');

    let s = await watchMarks(cdp, 3000, 'window.__nav("B")');
    console.log('    A->B', JSON.stringify(s));
    assert.deepEqual(
      s,
      [2, 0, 1],
      'B: old dividers cleared, then B (1 divider)',
    );
    console.log('ok  navigation clears the old chapters and shows new ones');

    s = await watchMarks(cdp, 3000, 'window.__nav("C")');
    console.log('    B->C', JSON.stringify(s));
    assert.deepEqual(s, [1, 0], 'C has no chapters; none may be inherited');
    console.log(
      'ok  a video without chapters inherits nothing (stale ytInitialData)',
    );

    s = await watchMarks(cdp, 3000, 'window.__nav("A")');
    console.log('    C->A', JSON.stringify(s));
    assert.deepEqual(s, [0, 2], 'A back: applied');
    console.log('ok  revisiting a video restores its chapters');

    s = await watchMarks(cdp, 3500, 'window.__quality()');
    console.log('    quality switch', JSON.stringify(s));
    assert.deepEqual(
      s,
      [2],
      'no blink on a source change within the same video',
    );
    console.log('ok  a source change inside the same video does not blink');

    s = await watchMarks(cdp, 3000, 'window.__nav("D"); window.__ad(true)');
    console.log('    D under pre-roll ad', JSON.stringify(s));
    assert.deepEqual(s, [2, 0], 'no chapters drawn while an ad plays');
    s = await watchMarks(cdp, 3000, 'window.__ad(false); window.__quality()');
    console.log('    ad ends', JSON.stringify(s));
    assert.deepEqual(s, [0, 1], 'D chapters appear once the ad is over');
    console.log('ok  chapters wait for the ad to end');
  } finally {
    await ctx.close();
    if (server) server.close();
  }
};

run().then(
  () => console.log('ALL OK'),
  (e) => {
    console.error('FAIL', e.message);
    process.exit(1);
  },
);
