import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import path, { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const SVG_PATH = resolve('src/icons/icon.svg');
const OUTPUTS = [
  { size: 16, path: resolve('src/icons/icon-16.png') },
  { size: 32, path: resolve('src/icons/icon-32.png') },
  { size: 48, path: resolve('src/icons/icon-48.png') },
  { size: 128, path: resolve('src/icons/icon-128.png') },
  { size: 300, path: resolve('docs/store/tile-300.png') },
];

const renderIcons = async () => {
  const svg = await readFile(SVG_PATH, 'utf8');
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
    args: ['--no-first-run', '--no-default-browser-check'],
    env: { ...process.env, HOME: '/tmp', XDG_CONFIG_HOME: '/tmp' },
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 300, height: 300 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    for (const target of OUTPUTS) {
      fs.mkdirSync(path.dirname(target.path), { recursive: true });
      await page.setViewportSize({ width: target.size, height: target.size });
      const sizedSvg = svg.replace(
        /<svg\b/,
        `<svg style="display:block;width:${target.size}px;` +
          `height:${target.size}px;"`,
      );
      await page.setContent(
        '<!doctype html><html><body style="margin:0;' +
          'background:transparent;overflow:hidden;' +
          `width:${target.size}px;height:${target.size}px;">` +
          `${sizedSvg}</body></html>`,
      );
      await page.screenshot({ path: target.path, omitBackground: true });
      const rel = path.relative('.', target.path);
      console.log(`Rendered ${target.size}x${target.size} -> ${rel}`);
    }
  } finally {
    await browser.close();
  }
};

renderIcons().catch((error) => {
  console.error(error);
  process.exit(1);
});
