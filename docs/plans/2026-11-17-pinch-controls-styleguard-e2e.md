# Follow-Up Fix Plan (`0.11.1`): Audit-of-Audit Remediation (`P7`–`P6`, `07119be` Revert)

**Date:** 2026-11-17
**Baseline Commit:** `02393b0` (HEAD on `main`, post `0.11.0` commits `7d5a248`, `07119be`, `7bbdf44`)
**Stage:** Stage 3–4 Complete (`154/154` unit tests, `2/2` E2E suites pass); Stage 5 Committed & Packed `.crx` for Final Physical Android Verification (Keeping Temporary `debuglog.js` per `R8` Until Confirmed)

---

## 1. Security Check (`P7`) & Baseline Audit Corrections (`C1`–`C4`, M9)

### `P7` — Signing Key / Package Tracking Audit (`[EMPIRICAL]`)

Ran directly against git index and full repository history:

- `git ls-files | grep -E '\.(pem|crx|zip|xpi)$'` → empty (`TRACKED_CLEAN`).
- `git log --all --oneline -- 'artifacts/*' '*.pem' '*.crx' '*.zip' '*.xpi'` → empty (zero commits ever added signing keys or package binaries).
- [`.gitignore`](../../.gitignore) ignores `artifacts/`, `*.pem`, `*.crx`, `*.zip`, `*.xpi`.
- **Verdict:** Private key `artifacts/nocturne-edge.pem` has never been committed or leaked; no key rotation or history purge is required.

### Edge Canary Android 160 Hardware Probe Evidence (`[EMPIRICAL]`)

From user runs on Edge Canary Android with [`_scratch/probe_rotate_fullscreen.html`](../../_scratch/probe_rotate_fullscreen.html) and extracted screenshots in `_scratch/probe_screenshots/`:

- **Top white/grey bar & half-left bar (`ab37d5f2bc1b3c45650a3.jpg`, `ffe3e52d8cc40c9a55d54.jpg`, `730797c1fe287e7627392.jpg`, `52c0b201dbe85bb602f91.jpg`, `T1`–`T4` probe):** Testing `T1` (`video.requestFullscreen()`), `T2` (plain `div` without `{ navigationUI: 'hide' }`), `T3` (`viewport-fit=cover`), and `T4` (`vp=cover` + `#000` root) confirmed **none** remove the bar on an affected tab; refreshing the page clears it **even with Nocturne disabled**. This closes the top-bar/half-bar visual artifact as an upstream Edge Canary Android tab-shell bug, confirming `07119be` (`applyBlackThemeColor`) must be reverted cleanly per M9.
- **Pinch-zoom time-delayed failure with empty `debuglog`:** On-device observation that pinch breaks after a short period while `fullscreenchange`/`resize`/`blur` logs remain empty isolates the failure inside extension-internal guards & gesture state that emit zero `debuglog` lines:
  1. `MAX_REPINS = 240` disconnects `styleGuard` silently in ~4s (`60fps`) against site `style` writes (`console.warn` only), matching "fails after a period of time" (`P4`).
  2. Visible `.chrome` controls (`CHROME_IDLE_MS = 3000ms` transitions) swallow 2nd-finger touches (`P1`).
  3. Any orphaned `pointerId` (missed `up`/`cancel` from OS edge gestures or hiding `.chrome`) or `MODE.ABANDONED` leaves `pointers` permanently desynced for later pinches (`P2` + stale-pointer reset).
- **Fullscreen retention across `screen.orientation.lock()` (`3185ms`–`6889ms`) & `R6` honesty:** Plain `AUTO TOP` and `AUTO IFRAME 384x216` with live `<video>` kept `fsEl` intact across `lock(landscape)` → `lock(portrait)` (`inner=384x798`), whereas Nocturne inside an embedded `384x216` iframe page dropped `fsEl=null` 28ms after `portrait` settled (`45995ms`–`46023ms`) without any same-frame `MAIN exitFullscreen` log. Reverting `07119be` removes one hypothesis, while other candidates (`STAGE_CSS`, `color-scheme:dark`, `startStabilizeRelayout`, `noteTurn`, outer parent frame `exitFullscreen`) remain to be A/B bisected on device; `P5` enforces honest pseudo-fullscreen status rather than fixing why `fsEl` dropped.
- **Empirical DOM & Cascade Check (`R1`, live Edge Pixel 7):** Inspected active `<video>` inside `[data-nocturne-player]`: `video.getRootNode() === document` (`true`), `video.parentElement.tagName === 'DIV'` with `[data-nocturne-player]`, `children = ["VIDEO", "STYLE", "DIV[host]"]`. Confirmed in Edge Blink that `[data-nocturne-player] > video { transform: var(--nocturne-transform, none) !important }` inside `STAGE_CSS` with `--nocturne-transform` on `stage.style` keeps `getComputedStyle(video).transform === matrix(2, 0, 0, 2, 0, 0)` even after `video.style.cssText = 'width:123px;transform:scale(1);'`.
- **Nits (`R9`):** Remove unused `snapPinchScale` from [`src/content/video/zoom.js`](../../src/content/video/zoom.js), [`src/content/video/visuals.js`](../../src/content/video/visuals.js), and [`test/unit/zoom.test.js`](../../test/unit/zoom.test.js) so test coverage reflects real production policy; export `PINCH_RESET_THRESHOLD = 1.03` cleanly.

### Workspace Hygiene (`PD` / `R8` Order Fix)

- Delete unrelated stale handoff [`docs/HANDOFF-2026-11-17.md`](../../docs/HANDOFF-2026-11-17.md) (fixes Prettier lint).
- **Retain** temporary on-device diagnostics ([`src/content/debuglog.js`](../../src/content/debuglog.js), `fullscreen.main.js` `reportCall`, `session.js` `dbg` + styleGuard/pointer transition logs) until mobile Edge Canary confirms pinch-after-time is fixed and `07119be` revert / `fsEl` A/B check completes; remove diagnostics right after device confirmation.

### Corrections Accepted from Audit-of-Audit

- **M2 Real-Blink Evidence:** In `_scratch/probe_pinch_e2e.mjs` (Pixel 7 `412×915`, 2.35:1 video where `cover ≈ 5.226`), pinching on `.surface` scaled cleanly to `3.17391` (`146/46`) and stayed `3.17391` after finger release — verifying the M2 **KEEP** policy on live Blink.
- **`C1` Capture-Phase Host Listeners:** Capture order (`window → document → … → stage`) means listeners inside `stage` always run after `document` capture handlers registered before `content.js` (`document_idle`). Reclassify as a **known DOM platform limitation** rather than attempting brittle page-world capture interception; measure actual real-site side effects on `m.youtube.com` instead.
- **`C2` Transient User Activation:** Capture listeners do **not** consume transient user activation; only timer expiry (~1s) or activation-consuming APIs do. Fullscreen rejection causes to measure in `P5` are `document.fullscreenEnabled === false` (e.g. iframe missing `allow="fullscreen"`), `await` chains exceeding the transient window, or Android shell rejection.
- **`C3` `touch-action` Cascade Composition:** Browsers intersect `touch-action` from target up through ancestors to the nearest scroll container, so `:host { touch-action: none }` constrains non-scrolling shadow descendants. No redundant `touch-action` CSS rules needed.
- **`M9` Violation Revert (`07119be`):** Revert `applyBlackThemeColor()` in [`src/content/session.js`](../../src/content/session.js) (`openStage` / `exit` `<meta name="theme-color">` host mutation), which was added without device probe proof contrary to M9. Keep static `<meta name="theme-color" content="#000000" />` only on extension-owned [`src/local/local.html`](../../src/local/local.html).
- **Nits:** Remove unused `snapPinchScale` import/`{ snap }` option in [`src/content/video/visuals.js`](../../src/content/video/visuals.js) (keeping `snapPinchScale` exported in [`src/content/video/zoom.js`](../../src/content/video/zoom.js) for unit tests), and unify the pinch release reset threshold into one named constant `PINCH_RESET_THRESHOLD = 1.03` shared across code, tests, and docs.

---

## 2. Implementation Plan (`P1`–`P6`)

### `P1` — Shadow-Root Capture Pre-Emption + Mandatory Forwarding (`src/content/ui.js`, `src/content/gestures/recognizer.js`)

- **Problem:** `chrome` controls (`.topbar`, `.centre-row > *`, `.seek-area`, `pointer-events: auto`) sit above sibling `.surface` inside `ui.shadow`. A 2-finger pinch starting on/near visible controls never reaches `.surface` (`p2Move` stayed frozen at `scale(2)` in CDP probe).
- **Design (`PB` / `R2`, `R4`):**
  - Keep existing `.surface` listeners intact so lone taps/drags hit controls normally **and** direct `createRecognizer(surface, ...)` unit tests remain clean.
  - Expose `adoptPointers(entries)`, `handlePointerEvent(type, event)`, `resetPointers()`, and `getPointerCount()` on `recognizer`, idempotently merging by `pointerId` (`Map.set`) so Finger 1 already tracked via `.surface` is never duplicated, ending any active `DRAG`/`HOLD` once cleanly (`H1`) and entering `PINCH` once.
  - Suspend `CHROME_IDLE_MS` auto-hide timer while `pointers.size > 0` (`pinchArmed` or `.surface` active touch) and reschedule on final finger lift so controls never disappear mid-gesture.
  - In [`src/content/ui.js`](../../src/content/ui.js), track active pointers on `shadow` in **capture phase** (`pointerdown`, `pointermove`, `pointerup`, `pointercancel`, `lostpointercapture`):
    - While `!pinchArmed` and `seen.size <= 1`: track whether Pointer 1 began inside `.chrome` (`hadChromeDown`); do **not** call `stopPropagation()`.
    - When `seen.size >= 2` and spread `>= 12px` (on `pointerdown` or `pointermove`): set `pinchArmed = true`, arm `swallowNextClick = hadChromeDown`, call `recognizer.adoptPointers(seen)`, and call `event.stopPropagation()`.
    - While `pinchArmed === true`: **MUST forward** every `pointerdown`, `pointermove`, `pointerup`, `pointercancel`, and `lostpointercapture` directly to `recognizer.handlePointerEvent(event.type, event)` after calling `event.stopPropagation()` (otherwise `.surface` capture-blocked targets freeze pinch after arming). Remove pointer IDs on `up`/`cancel`/`lostpointercapture`.
    - When `seen.size === 0`: clear `pinchArmed = false`, `hadChromeDown = false`, and disarm `swallowNextClick` via short fallback timer (`80ms`) **plus** immediate disarm on any subsequent `pointerdown` so valid Play/button taps right after pinch are never swallowed; capture `click` only swallows when `swallowNextClick && chrome.contains(event.target)`.

### `P2` — Re-Pinch Out of `MODE.ABANDONED` & Stale Pointer Self-Healing (`src/content/gestures/recognizer.js`, `src/content/ui.js`)

- **Problem:**
  - After lifting 1 finger from a 2-finger pinch (`mode === MODE.ABANDONED`, `pointers.size === 1`), placing the 2nd finger down again without lifting Finger 1 is deadlocked by `if (mode === MODE.ABANDONED) return;`.
  - If any touch misses `pointerup`/`pointercancel` (e.g. Android system edge gesture, hiding `.chrome` elements mid-touch, or focus transition), a stale `pointerId` stays in `pointers` / shadow `seen` permanently, corrupting every subsequent pinch/pan forever ("breaks after some time" while `debuglog` stays empty).
- **Design:**
  - Keep 1-finger `pointermove` ignored while `mode === MODE.ABANDONED` (no accidental 1-finger pan/seek/swipe).
  - Allow `handleDown` and `handleMove` in `MODE.ABANDONED` when `pointers.size >= 2`: if pair distance `>= 12px`, call `startPinch()`, emitting `pinchStart` so `visuals.beginPinch()` re-anchors `pinchOrigin` at the current held `view.scale`/`view.x`/`view.y` with zero scale jump.
  - Clear orphaned pointer state automatically on fresh primary touch (`event.pointerType === 'touch' && event.isPrimary === true` with stale entries when browser starts a new primary touch — both in `recognizer` and `P1` shadow tracker, without affecting synthetic test events lacking `isPrimary`), and expose `resetPointers()` wired to `window` `blur` / `document` `visibilitychange` / `fullscreenchange` teardown paths.
  - **Cross-invariant `P2 × P3` (`PC` / `R5`):** Every reset path (`resetPointers`, `blur`, `visibilitychange`, `fullscreenchange`, `overlay.destroy`, `session.exit`) MUST force-clear active gestures via `visuals.endPinch()` + `visuals.endPan()`, flushing any `pendingRelayout` immediately so `isPinching`/`isDragging` can never freeze relayout permanently.

### `P3` — `relayout()` Zero-Dim & Active-Gesture Guard (`src/content/video/visuals.js`)

- **Problem:** `window`/`visualViewport` `resize` can invoke `relayout()` while `isPinching` / `isDragging` is true or while `video.videoWidth === 0` / stage bounds are `0`, mutating `view` mid-gesture.
- **Design:**
  - Guard `relayout()` with `if (!video.videoWidth || size.width <= 0 || size.height <= 0) return false;` and defer while `isPinching || isDragging` (`pendingRelayout = true`).
  - Flush `if (pendingRelayout) { pendingRelayout = false; relayout(); }` in `endPinch()` and `endPan()`.

### `P4` — Declarative CSS Variables + `!important` Stylesheet & Recovering Cooldown Guard (`src/content/session.js`, `src/content/video/visuals.js`)

- **Problem:** Relying solely on `MutationObserver(pin)` against `requestAnimationFrame`-looping players hits `MAX_REPINS = 240` within 2–4 seconds and disconnects permanently.
- **Design (`PA` / `R1`, `R3`):**
  - Move `VIDEO_STYLE` + visual properties (`transform`, `filter`, `transition`) into `[data-nocturne-player] > video { ... !important }` rules inside `STAGE_CSS` (verified light-DOM direct child selector of `<div data-nocturne-player>`), driven by inherited CSS custom properties `--nocturne-transform`, `--nocturne-filter`, `--nocturne-transition` written by `visuals.apply()` onto `stage.style` (with safe fallback to `video.style` for minimal test mocks).
  - Non-`!important` inline writes by site scripts (`video.style.transform = ...`, `video.style.width = ...`) automatically lose at CSS cascade with zero `MutationObserver` feedback loop or DOM repins.
  - Update `isVisualStyleIntact(video, overlay, stage)` (`R3`) so clean/non-`!important` inline video styles are treated as **intact** (`0` repins!) and `pin()` only strips conflicting inline `!important` overrides (`video.style.getPropertyPriority(k) === 'important'`) or re-syncs tampered `stage` custom props via `overlay.repin()`.
  - Use a **sliding-window burst detector** (`> 30` repins within `2000ms`) that pauses `styleGuard` temporarily and re-arms via exponential backoff (`5s -> 15s -> 45s`, cap `60s`), resetting immediately on user pinch/rotate or video switch (`show()`). Remove permanent `styleGuard` disconnection.
  - Keep safe optional-chaining fallback when `getPropertyValue` is omitted on test mocks.

### `P5` — `requestFullscreen` Honesty & Retargeting Check (`src/content/session.js`)

- **Design:**
  - Check `doc.fullscreenEnabled` before `requestFullscreen`.
  - After `await requestFullscreen(stage)` in `enter()`, check `isStageFullscreen()` (`document.fullscreenElement === stage || document.fullscreenElement === ui.host`):
    - If rejected / false (including inside `iframes` without `allow="fullscreen"`), set `stage.dataset.nocturnePseudoFullscreen = 'true'` (clear on exit/successful fullscreen), notify briefly, and retry `requestFullscreen(stage)` cleanly once on the next user tap/fullscreen gesture. Note: this reports pseudo-fullscreen honestly rather than fixing Edge's native `fsEl` loss.

### `P6` — Promote Pinch & Guard Probe into `test/e2e/pinch-rotate.mjs` (`test/e2e/pinch-rotate.mjs`, `package.json`)

- Create `test/e2e/pinch-rotate.mjs` verifying in headless desktop Microsoft Edge (`Pixel 7` profile):
  1. Pinch starting directly over visible `.centre-row` button zooms cleanly without toggling play/pause (`swallowNextClick`).
  2. Lifting 1 finger and re-placing 2nd finger continues pinch smoothly from current scale (`P2`).
  3. Dispatching `window` `resize` mid-pinch defers relayout and flushes on gesture end (`P3`).
  4. Host script running synchronous/`rAF` style mutations (`width: 300px; transform: scale(1)` + burst `!important` writes) survives cleanly without killing `styleGuard` (`P4`).
  5. Light-DOM CSS cascade check: `[data-nocturne-player] > video` `!important` preserves `getComputedStyle(video).transform` when site overwrites `video.style.cssText` (`R1`).
  6. Tapping Play button immediately after finishing a pinch works cleanly (`R4`).
  7. `resetPointers` / `blur` mid-pinch + `resize` forces `endPinch()`/`endPan()` and runs relayout (`R5`).
- Wire `npm run test:e2e` to execute both `chapters-spa.mjs` and `pinch-rotate.mjs`.

---

## 3. Acceptance & Gate Rules

- **Done criteria for Stage 3–5:**
  1. `npm run lint` passes (ESLint max-len `<= 80`, Prettier, `lint:privacy` clean).
  2. `npm test` passes with unit tests for `P1` (`adoptPointers`, forwarder, click disarm, idle timer suspend), `P2` (re-pinch out of `ABANDONED`, `isPrimary` stale-pointer heal), `P3` (`pendingRelayout` defer/flush + `R5` reset invariant), `P4` (empty/non-important inline treated intact, inline `!important` stripped, burst cooldown/re-arm), and `P5` (`nocturnePseudoFullscreen` + M9 `07119be` revert).
  3. `npm run build:clean && npm run validate:mv3 && npm run package && HOME=/tmp XDG_CONFIG_HOME=/tmp npm run test:e2e` all pass.
  4. Docs updated honestly (`CHANGELOG.md`, `docs/changelogs/2026-11-16-mobile-fullscreen-content-uri-rotate.md`, `README-edge.md`, this plan status) reflecting `C1`–`C4`, `R1`–`R9`, and `T1`–`T4` Edge Canary 160 evidence.
  5. **Revised Feasible Publish Gate (`PE` / `R7`) — Locked Until Mobile Check Completes:** Upstream Edge Canary 160 top/half bar (resolved by tab Refresh, reproduced without extension) is reclassified as a **documented upstream limitation** (not a Store blocker). Remaining on-device verification criteria on physical Edge Android before publishing:
     - Pinch-to-zoom survives `> 5` minutes on `m.youtube.com` (including when `.chrome` is shown), then remove temporary `debuglog.js` / diag hooks cleanly;
     - `screen.orientation.lock()` on real device (`fsEl` retention or honest `nocturnePseudoFullscreen` handling + A/B bisect if `fsEl` drops in `iframe`);
     - `local.html` file picker tested with real Android `content://` media blob;
     - Known-limitations note documenting the upstream Edge top-bar refresh / `local.html` workaround.
