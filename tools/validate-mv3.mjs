import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const DIST_DIR = 'dist';

const collectIconPaths = (manifest) => {
  const paths = new Set();
  for (const rel of Object.values(manifest.icons ?? {})) paths.add(rel);
  for (const rel of Object.values(manifest.action?.default_icon ?? {})) {
    paths.add(rel);
  }
  return Array.from(paths);
};

const validate = async () => {
  const manifestPath = join(DIST_DIR, 'manifest.json');
  assert.ok(existsSync(manifestPath), 'dist/manifest.json is missing');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

  assert.equal(manifest.manifest_version, 3, 'Expected MV3 manifest_version');
  assert.ok(
    typeof manifest.name === 'string' && manifest.name.length > 0,
    'Manifest name must be non-empty',
  );
  assert.match(
    manifest.version ?? '',
    /^\d+(\.\d+){1,3}$/,
    'Store version must be dot-separated integers (e.g. 0.10.0)',
  );
  assert.equal(
    manifest.browser_specific_settings,
    undefined,
    'Firefox browser_specific_settings must not ship in Edge MV3 manifest',
  );

  for (const iconRel of collectIconPaths(manifest)) {
    assert.ok(existsSync(join(DIST_DIR, iconRel)), `Missing icon: ${iconRel}`);
  }
  if (manifest.action?.default_popup) {
    assert.ok(
      existsSync(join(DIST_DIR, manifest.action.default_popup)),
      `Missing popup: ${manifest.action.default_popup}`,
    );
  }
  for (const rel of ['local.html', 'local.css', 'local.js']) {
    assert.ok(existsSync(join(DIST_DIR, rel)), `Missing local asset: ${rel}`);
  }

  let hasMainWorldAgent = false;
  for (const entry of manifest.content_scripts ?? []) {
    for (const scriptRel of entry.js ?? []) {
      const full = join(DIST_DIR, scriptRel);
      assert.ok(existsSync(full), `Missing content script: ${scriptRel}`);
      if (entry.world === 'MAIN') {
        hasMainWorldAgent = true;
        const body = await readFile(full, 'utf8');
        assert.ok(
          !body.includes('globalThis.chrome'),
          `${scriptRel} must not contain chrome polyfill (C7)`,
        );
      }
    }
  }
  assert.ok(hasMainWorldAgent, 'Expected a MAIN-world content script');

  console.log(
    `MV3 package valid: ${manifest.name} v${manifest.version} (${DIST_DIR}/)`,
  );
};

validate().catch((error) => {
  console.error('MV3 validation failed:', error);
  process.exit(1);
});
