import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const SOURCE_DIR = 'src';
const OUTPUT_DIR = 'dist';
const TARGET = 'chrome111';

// Chromium exposes the extension APIs under `chrome.*`. Firefox also accepts
// that namespace, so the port keeps the upstream `browser.*` calls and aliases
// them here. Injected only into the two ISOLATED bundles: the MAIN-world agent
// must never touch the page's globals.
const BROWSER_SHIM =
  'globalThis.browser = globalThis.browser || globalThis.chrome;';

const staticAssets = [
  {
    from: `${SOURCE_DIR}/manifest.mv3.json`,
    to: `${OUTPUT_DIR}/manifest.json`,
  },
  { from: `${SOURCE_DIR}/icons`, to: `${OUTPUT_DIR}/icons` },
  { from: `${SOURCE_DIR}/popup/popup.html`, to: `${OUTPUT_DIR}/popup.html` },
  { from: `${SOURCE_DIR}/popup/popup.css`, to: `${OUTPUT_DIR}/popup.css` },
  { from: `${SOURCE_DIR}/local/local.html`, to: `${OUTPUT_DIR}/local.html` },
  { from: `${SOURCE_DIR}/local/local.css`, to: `${OUTPUT_DIR}/local.css` },
];

const bundles = [
  {
    entry: `${SOURCE_DIR}/content/index.js`,
    out: `${OUTPUT_DIR}/content.js`,
    banner: BROWSER_SHIM,
  },
  {
    entry: `${SOURCE_DIR}/popup/popup.js`,
    out: `${OUTPUT_DIR}/popup.js`,
    banner: BROWSER_SHIM,
  },
  {
    entry: `${SOURCE_DIR}/local/local.js`,
    out: `${OUTPUT_DIR}/local.js`,
    banner: BROWSER_SHIM,
  },
  {
    // MAIN world. No browser.* shim: it runs in the page's own context.
    entry: `${SOURCE_DIR}/content/pageagent.js`,
    out: `${OUTPUT_DIR}/pageagent.js`,
  },
];

// Shipped unminified on purpose: reviewers and users read exactly what runs.
const isDebug =
  process.env.NOCTURNE_DEBUG === '1' || process.argv.includes('--debug');

const bundleOptions = {
  bundle: true,
  format: 'iife',
  target: TARGET,
  platform: 'browser',
  charset: 'utf8',
  legalComments: 'inline',
  minify: false,
  sourcemap: false,
  loader: { '.css': 'text' },
  define: {
    'globalThis.__NOCTURNE_DEBUG__': JSON.stringify(isDebug),
  },
};

// Files are overwritten in place rather than wiping the directory: removing and
// recreating dist/ detaches a file watcher during a rebuild loop.
const buildAll = async () => {
  if (process.argv.includes('--clean')) {
    await rm(OUTPUT_DIR, { recursive: true, force: true });
  }
  await mkdir(OUTPUT_DIR, { recursive: true });

  for (const asset of staticAssets) {
    await cp(asset.from, asset.to, { recursive: true });
  }

  for (const bundle of bundles) {
    const options = {
      ...bundleOptions,
      entryPoints: [bundle.entry],
      outfile: bundle.out,
    };
    if (bundle.banner) options.banner = { js: bundle.banner };
    await build(options);
  }

  console.log(`Built ${bundles.length} bundles into ${OUTPUT_DIR}/`);
};

buildAll().catch((error) => {
  console.error(error);
  process.exit(1);
});
