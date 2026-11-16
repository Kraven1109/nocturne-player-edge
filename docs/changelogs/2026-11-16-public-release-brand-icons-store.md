# Changelog: Public Release Readiness, Naming, Eclipse Halo Icons & Store Kit

**Date:** 2026-11-16  
**Plan:** [`docs/plans/2026-11-16-public-release-brand-icons-store.md`](../plans/2026-11-16-public-release-brand-icons-store.md)

## Summary

1. **Branding, Naming & Versioning (`Nocturne Player for Edge`, `0.10.0`):**
   - Updated [`src/manifest.mv3.json`](../../src/manifest.mv3.json), [`package.json`](../../package.json), and [`src/popup/popup.html`](../../src/popup/popup.html) to `Nocturne Player for Edge` `0.10.0` (Edge Store numeric version format, removing `-edge` suffix and stale `pohoriletts`/`kvachikk` source links while preserving upstream MPL-2.0 credit).
2. **Eclipse Halo Icon Suite (`src/icons/icon.svg`, `tools/render-icons.mjs`):**
   - Redesigned `src/icons/icon.svg` with a symmetric golden amber crescent + cool Edge cyan base arc framing an optically centered play prism over a deep midnight twilight squircle.
   - Added deterministic icon generator `tools/render-icons.mjs` (`npm run icons`) producing `src/icons/icon-{16,32,48,128}.png` and Edge Store promo tile `docs/store/tile-300.png`.
3. **CI / MV3 Validation & Privacy Guard Alignment:**
   - Updated [`tools/check-privacy.mjs`](../../tools/check-privacy.mjs) to enforce the permission allowlist directly against `src/manifest.mv3.json`.
   - Added [`tools/validate-mv3.mjs`](../../tools/validate-mv3.mjs) (`npm run validate:mv3`) verifying MV3 structure, store-compliant numeric version, required icon/script files, and Rule C7 (`MAIN`-world `pageagent.js` free of `globalThis.chrome` polyfill).
   - Replaced failing Firefox `web-ext lint` calls in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) and [`.github/workflows/release.yml`](../../.github/workflows/release.yml) with `npm run validate:mv3` + `npm run package` producing `artifacts/nocturne-edge.zip`.
4. **Community Docs, Attribution & Edge Store Submission Kit:**
   - Added [`NOTICE`](../../NOTICE) with explicit MPL-2.0 upstream attribution (`Vlad Pohorilets`, `kvachikk/nocturne-player v0.9.1`).
   - Updated [`README.md`](../../README.md), [`PRIVACY.md`](../../PRIVACY.md), [`SECURITY.md`](../../SECURITY.md), [`CONTRIBUTING.md`](../../CONTRIBUTING.md), [`CHANGELOG.md`](../../CHANGELOG.md), and `.github/ISSUE_TEMPLATE/` for Edge MV3 contributors and users.
   - Created [`docs/store/EDGE_ADDONS_LISTING.md`](../store/EDGE_ADDONS_LISTING.md) with copy-ready Partner Center descriptions and reviewer justifications for `<all_urls>` / `world: "MAIN"` / `storage` / `activeTab`.
