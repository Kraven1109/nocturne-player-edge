# AGENTS.md — Golden Rules for Nocturne Player Edge Port

> **Golden rules for ANY AI Developer Agent (Antigravity IDE, Claude, Gemini, Cursor, Cline, Roo Code, etc.).**
> Rules here are **A-prefixed** (A0–A9) alongside Hard Constraints (**C1–C14**). Violations cause real damage or broken builds.
> **Single Source of Truth (SSoT):** This document (`.agents/AGENTS.md`) is the canonical golden ruleset. Root `AGENTS.md` is a gateway pointer.

---

## 1. Project Mission & Architecture Context

The **Nocturne Player Edge Port** project ports the Firefox/Gecko MV2 Web Extension `kvachikk/nocturne-player` (v0.9.1, commit `0de5804`, license MPL-2.0) to **Microsoft Edge (Chromium MV3)** on Linux (Edge 156+) and Windows.

### Canonical Architectural Decisions (SSoT: `PORT_PLAN.md`)

| Topic                    | Decision                                      | Technical Rationale                                                                                                                                                                                                                                                                                                          |
| ------------------------ | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **World Model**          | **2 Worlds**                                  | `pageagent.js` (`world: "MAIN"`, `run_at: "document_start"`) + `content.js` (`world: "ISOLATED"`, `run_at: "document_idle"`).                                                                                                                                                                                                |
| **Bridge Mechanism**     | **Synchronous `CustomEvent`, two directions** | Request `nocturne:req`: `bubbles: true` on `<video>` (or `document.documentElement` for page-level ops), caught on `document` with `capture: true`. Response `nocturne:res`: `bubbles: false` on the same `event.target`, caught by a one-shot listener on that target. Bypasses asynchronous `postMessage` queues entirely. |
| **Target Identity**      | **`event.target` in MAIN**                    | Elements cannot be passed as object handles across worlds. Identify `<video>` via `event.target`, **do not** inject `data-*` attributes into the page DOM.                                                                                                                                                                   |
| **Page State Storage**   | **`WeakMap<HTMLVideoElement, PlayerState>`**  | Scoped to MAIN world. Automatically garbage-collected with element lifecycle; prevents memory leaks on SPAs (e.g. YouTube video transitions).                                                                                                                                                                                |
| **Bridge Data Transfer** | **Flat JSON-serializable DTOs**               | Only plain data objects transferred in `event.detail` (no DOM nodes, functions, or complex prototypes).                                                                                                                                                                                                                      |
| **Consumer APIs**        | **Strictly Synchronous**                      | Menu, quality, and audio/text tracks preserve synchronous return semantics — **NO** async/await refactoring across consumers.                                                                                                                                                                                                |
| **Fullscreen Lock**      | **Early Monkeypatch in MAIN**                 | Patch `Element.prototype.requestFullscreen` & `Document.prototype.exitFullscreen` at `document_start` gated by a boolean flag `locked = false`.                                                                                                                                                                              |
| **Audio Tracks**         | **Engine APIs Mandatory**                     | Chromium / Blink natively returns `video.audioTracks === undefined`. Fallbacks must strictly query engine APIs (HLS, DASH, Shaka, YouTube, Playerjs).                                                                                                                                                                        |
| **Packaging & MV3**      | **Native Chromium MV3**                       | `manifest.mv3.json`, PNG action icons (`16`, `32`, `48`, `128`), and banner polyfill `globalThis.browser = globalThis.browser                                                                                                                                                                                                |     | globalThis.chrome;`**only** in isolated bundles (never in`pageagent.js`). |

---

## 2. Hard Constraints at a Glance

| #       | Constraint                                                                                                                                                                           | Violation =                                      |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| **C1**  | Validate `manifest.mv3.json` and `package.json` syntax before committing                                                                                                             | Extension load failure / crash                   |
| **C2**  | Maintain synchronous consumer semantics; never convert menu/quality getters to `async`                                                                                               | UI flickering and race conditions on menu render |
| **C3**  | Never guess Blink or Edge extension behavior — probe in `_scratch/` first                                                                                                            | Silent execution failures                        |
| **C4**  | Never mark done until build (`npm run build`), tests (`npm test`), and Edge verification succeed                                                                                     | Broken extension shipped                         |
| **C5**  | Every code change MUST update affected docs (`PORT_PLAN.md`, `README-edge.md`, changelog)                                                                                            | Stale docs → architectural regressions           |
| **C6**  | No production file touched until plan is explicitly approved (Stage 2 Gate)                                                                                                          | Unreviewed code shipped                          |
| **C7**  | Never inject extension polyfills (`globalThis.browser`) into the page MAIN world                                                                                                     | Page global namespace contamination              |
| **C8**  | Every changed line traces to approved plan — no drive-by refactoring                                                                                                                 | Scope creep / diff bloat                         |
| **C9**  | Keep upstream MPL-2.0 compliance intact: preserve license headers, attribute modifications                                                                                           | Legal/licensing violation                        |
| **C10** | **Playwright with Edge Testing First**: Validate extension features against Microsoft Edge with proper environment isolation (`HOME=/tmp`, `XDG_CONFIG_HOME=/tmp`). Never test blind | Untested DOM bridge regressions                  |
| **C11** | Never touch git (commit/stage/push) during probe/test/debug phase                                                                                                                    | Accidental debug commits                         |
| **C12** | Never run force/recursive deletions without path validation guards                                                                                                                   | Accidental wipeout of files                      |
| **C13** | Output one **Diff & Audit Report** per Phase (end of the phase), from real `git diff`, with plan traceability                                                                        | Unaudited changes shipped                        |
| **C14** | All probe scripts, test traces, screenshots, and logs MUST live in `_scratch/`                                                                                                       | Repo root & system clutter                       |

---

## 3. Playwright with Microsoft Edge Testing Guide

To test extension features and web interactions faithfully without installing redundant browser binaries or encountering Linux sandbox permission issues, this project adopts the **System Microsoft Edge standard** (established in `AI_for_everyone_UTH`).

### 3.1. Core Principles

1. **Use System Microsoft Edge (`channel="msedge"`):**
   - Automatically maps to the host's `/usr/bin/microsoft-edge-stable` on Linux (or system Edge on Windows).
   - Eliminates downloading ~300MB+ redundant Chromium/Firefox binaries into `~/.cache/ms-playwright/`.
2. **Mandatory Sandbox Environment Guards (`HOME=/tmp`, `XDG_CONFIG_HOME=/tmp`):**
   - On Linux systems with restricted or read-only user directories (such as agent sandboxes), Edge attempts to touch `~/.local/share/applications/mimeapps.list` or create config files.
   - **Crucial Fix:** Always pass `env={**os.environ, "HOME": "/tmp", "XDG_CONFIG_HOME": "/tmp"}` in Python, or `{ ...process.env, HOME: '/tmp', XDG_CONFIG_HOME: '/tmp' }` in Node.js.
3. **Headless Extension Loading (`--headless=new`):**
   - Chromium MV3 extensions do not load in legacy headless mode or incognito contexts.
   - Use `launch_persistent_context` with `--headless=new` and extension loading flags:
     `--disable-extensions-except=<path_to_dist>` and `--load-extension=<path_to_dist>`.
4. **Clean Artifact Output in `_scratch/`:**
   - Screenshots, HAR traces, console error logs, and probe results must output to `_scratch/` and never clutter the workspace root.

---

### 3.2. Playwright Runner (Node.js, `playwright-core`)

When integrating into `npm test` or standalone JS diagnostic scripts, use **`playwright-core`** (no bundled browser download) with the system Edge binary:

```javascript
import { chromium } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const WORKSPACE_DIR = process.cwd();
const DIST_DIR = path.join(WORKSPACE_DIR, 'dist');
const SCRATCH_DIR = path.join(WORKSPACE_DIR, '_scratch');
if (!fs.existsSync(SCRATCH_DIR)) fs.mkdirSync(SCRATCH_DIR, { recursive: true });

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-playwright-'));

async function testWithEdge() {
  const context = await chromium.launchPersistentContext(userDataDir, {
    // Playwright resolves `msedge` to /opt/microsoft/msedge/msedge on Linux.
    // If it cannot, pass executablePath: '/opt/microsoft/msedge/msedge'.
    channel: 'msedge',
    headless: true,
    args: [
      `--disable-extensions-except=${DIST_DIR}`,
      `--load-extension=${DIST_DIR}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
    // Essential Linux sandbox / permission bypass
    env: { ...process.env, HOME: '/tmp', XDG_CONFIG_HOME: '/tmp' },
  });

  const page = await context.newPage();
  page.on('console', (msg) =>
    console.log(`[EDGE CONSOLE] ${msg.type()}: ${msg.text()}`),
  );
  page.on('pageerror', (err) => console.error(`[EDGE ERROR] ${err}`));

  await page.goto('http://localhost:8422/test/fixtures/index.html');
  await page.waitForSelector('video');

  // NOTE: page.evaluate() runs in the page/MAIN world. It verifies the agent
  // only; it does NOT exercise ISOLATED -> MAIN. For the real bridge, click the
  // Nocturne badge and assert on the rendered menu DOM instead.
  const res = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const video = document.querySelector('video');
        video.addEventListener('nocturne:res', (e) => resolve(e.detail), {
          once: true,
        });
        video.dispatchEvent(
          new CustomEvent('nocturne:req', {
            bubbles: true,
            detail: { rid: 'probe-1', op: 'engines' },
          }),
        );
      }),
  );
  console.log('Agent probe:', res);

  await page.screenshot({
    path: path.join(SCRATCH_DIR, 'edge_node_probe.png'),
  });
  await context.close();
}

testWithEdge().catch(console.error);
```

---

### 3.3. Edge CLI Smoke Test (Without Playwright)

For rapid manual verification using system Edge:

```bash
microsoft-edge-stable \
  --user-data-dir=$(mktemp -d /tmp/edge-smoke-XXXXXX) \
  --load-extension=./dist \
  --no-first-run \
  --no-default-browser-check \
http://localhost:8422/test/fixtures/index.html
```

---

## 4. Context & Token Discipline

Treat the context window as a finite engineering budget:

- **Grep/glob before you read.** Target the specific function or file; never read 1,000-line bundles into context verbatim.
- **Read once, reuse.** Avoid loading the same file multiple times in a single turn.
- **Summarize, don't paste.** Report findings with concise bullet points and exact file links (`file:///...`).
- **Push reference material to `docs/` or `PORT_PLAN.md`**, not inlined repetitively in conversation messages.
- **Prefer diffs over whole-file rewrites** when editing files.
- **Scratch output discipline:** Store verbose probe logs in `_scratch/probe_*.log` and summarize status in chat.

---

## 5. Workspace Structure & Glossary

| Path                               | Description                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| `AGENTS.md` (root)                 | Lightweight redirect pointer to `.agents/AGENTS.md`.                                              |
| `.agents/AGENTS.md`                | **This file** — canonical rules, architecture decisions, and workflow standards.                  |
| `PORT_PLAN.md`                     | SSoT migration plan, experimental verification table, and phase checklist.                        |
| `src/`                             | Extension source code (vendored upstream + Edge modifications).                                   |
| `src/content/pageagent.js`         | MAIN world script injected at `document_start` (holds WeakMap & bridge listener).                 |
| `src/content/index.js`             | ISOLATED world entry (overlay UI & bridge client); esbuild bundles it to `dist/content.js`.       |
| `src/content/page/bridge.js`       | Synchronous `CustomEvent` bridge dispatcher (`nocturne:req` / `nocturne:res`).                    |
| `src/content/page/pageapi.main.js` | Adapters for MAIN world (replaces Gecko `wrappedJSObject` with native `window`).                  |
| `src/manifest.mv3.json`            | Manifest V3 specification for Chromium / Microsoft Edge.                                          |
| `dist/`                            | Build output target containing bundled JS, HTML, CSS, PNG icons, and manifest.                    |
| `test/fixtures/`                   | Local HTML fixtures for video playback, engine testing, and subtitles.                            |
| `docs/plans/`                      | Post-Phase-3 feature plans (`<date>-<slug>.md`). Not used for the Phase 0–3 port.                 |
| `docs/changelogs/`                 | Post-Phase-3 fix/feature records (`<date>-<fix>.md`). Phase 0–3 progress lives in `PORT_PLAN.md`. |
| `_scratch/`                        | Temporary diagnostic probes, Playwright test traces, and audit screenshots.                       |

---

## 6. DEV AGENT RULES (A0–A9)

### A0: Documentation Hygiene

**Every code change MUST update affected documentation.**

- Phase 0–3 port work → update checkboxes and notes directly in `PORT_PLAN.md` (the SSoT for port progress). Do **not** create per-step files under `docs/plans/` or `docs/changelogs/` for this phase.
- Architecture or protocol changes → update `PORT_PLAN.md` and `.agents/AGENTS.md`.
- Bug fixes **after Phase 3** → record in `docs/changelogs/<date>-<fix>.md`.
- One-off execution plans **after Phase 3** → `docs/plans/<date>-<slug>.md`.
- User-facing modifications → update `README-edge.md`.

### A1: Scratch Files — Clean Workspace

All temporary, probe, verification, or scratch scripts MUST reside in `_scratch/` — **never** in the repository root or random system paths.

- Add `_scratch/` to `.gitignore`.
- Name probe scripts clearly: `_scratch/probe_<feature>.<ext>`.

### A2: Verify With Scripts, Don't Guess

Never assume Blink/Edge DOM behavior, custom event propagation, or prototype inheritance. ALWAYS write and run a verification script in `_scratch/` first.

### A3: Debug & Verification Loop

1. **Isolate** — Reproduce the issue in `_scratch/` with a minimal HTML/JS probe.
2. **Instrument** — Log event propagation, DTO payloads, and timestamps.
3. **Fix** — Make the minimal surgical change adhering to project architecture.
4. **Verify** — Run `npm run build` and test against Edge via Playwright.
5. **Regression** — Verify on both basic `<video>` elements and engine-based players (YouTube, HLS).

### A4: Surgical Changes — Minimal Diff

Every changed line must trace directly to an approved plan item.

- Match existing code formatting, indentation, and semicolon conventions.
- Do not perform drive-by refactoring on untouched upstream files.

### A5: Surface Assumptions & Tool Gaps

- State technical assumptions explicitly.
- If existing tools or build scripts cannot handle a requirement, propose the update and get approval before executing workarounds.

### A6: Security & Untrusted Input

- **Content Security Policy (CSP):** Comply with Manifest V3 strict CSP. No inline script execution via `eval()` or string timers.
- **Bridge Data Sanitization:** Verify that `event.detail` contains only sanitized DTO data to prevent injection across worlds.
- **Secrets Redaction:** Never commit or print API keys, tokens, or credentials.

### A7: Self-Review Before Handoff

Before presenting changes:

1. Does every changed line trace directly to the plan?
2. Did `npm run build` succeed with zero errors?
3. Did `npm test` and Playwright Edge tests pass?
4. Are all temporary files confined to `_scratch/`?

### A8: Playwright & Edge Testing Discipline

- Always test with Microsoft Edge using `channel="msedge"` and `{ HOME: "/tmp", XDG_CONFIG_HOME: "/tmp" }`.
- Ensure process isolation by allocating unique temporary profiles per run (`mktemp -d`).
- Never leave dangling browser processes running in the background.

### A9: Anti-Sycophancy & External-Source Proof-of-Work

- **Zero Sycophancy:** No hollow praise ("Great plan", "Awesome code") and no gratuitous apologies.
- **Concrete Proof-of-Work:** Never declare a feature "tested", "working", or "fixed" without providing the exact command executed and its actual terminal output.
- **Tag Substantive Claims:**
  - `[EMPIRICAL]`: Verified by actual command output, probe script, or Edge Playwright run.
  - `[DESIGN CHOICE]`: Architectural preference where valid alternatives exist (must cite reasons).
  - `[UNVERIFIED]`: Assumptions not yet validated by runtime execution.

---

## 7. Development Workflow (5-Stage Fact-Based Standard)

> [!NOTE]
> Diagnostic probes in `_scratch/`, ad-hoc fixture tests, and read-only inspections do **NOT** require a formal plan. The 5-stage workflow strictly governs modifications to production source code and architecture.

```
Stage 1: Research & Plan  ──►  Stage 2: Plan Review Gate (Stop)  ──►  Stage 3: Implement with Facts
                                                                              │
                                                                              ▼
Stage 5: Document & Commit  ◄──  Stage 4: Test Everything  ◄──────────────────┘
```

### Stage 1 — Research & Plan

_(Read-only for production code; only `_scratch/` may change)_

1. Read `.agents/AGENTS.md` and `PORT_PLAN.md`.
2. Inspect relevant source modules and integration points.
3. Probe uncertain Blink/Edge behaviors in `_scratch/probe_*.js` or `_scratch/probe_*.py`.
4. Author/refresh the canonical plan in `PORT_PLAN.md` (Phase 0–3) and record probe results there. Only features **after Phase 3** get a separate `docs/plans/<date>-<slug>.md`.
5. Issue Stage 1 Checkpoint Report.

### Stage 2 — Plan Review & Confirmation Gate (Hard Stop)

- Present plan and Stage 1 Checkpoint Report to user.
- **STOP.** Do not edit or create production files until explicit user approval ("proceed", "approved") is received.

### Stage 3 — Implement with Facts

- Execute surgical changes matching the plan.
- Run build syntax checks (`npm run build`) after each logical change.
- Output **Diff & Audit Report** (see format below).
- Issue Stage 3 Checkpoint Report.

### Stage 4 — Test Everything

- Run unit test suite: `npm test`.
- Run Edge extension verification via Playwright (using Section 3 recipes).
- Verify fixtures on `http://localhost:8422` or `http://localhost:8777`.
- Issue Stage 4 Checkpoint Report.

### Stage 5 — Document & Commit

- Output **one consolidated Diff & Audit Report per Phase** (not twice per Stage 3/5).
- Self-review against checklist (A7).
- Update checkboxes and notes in `PORT_PLAN.md`; update `.agents/AGENTS.md` / `README-edge.md` only when the change affects them.
- Clean up one-off scratch files.
- Commit with a conventional message (`feat:`, `fix:`, `port:`, `docs:`, `chore:`).
- **Git baseline:** at the end of Phase 0, after vendoring upstream, run `git init` inside `nocturne-player-edge/` (the tree is currently inside an unrelated parent repo with no commits) and commit the vendored tree as `chore: vendor upstream nocturne-player v0.9.1 (0de5804)`. Later phases use this commit as the `git diff` base (C13).

---

### Checkpoint Report Format

```
Checkpoint — Stage <N>: <Stage Name>
- [x] <Completed item 1>
- [x] <Completed item 2>
- [ ] <Pending/Skipped item> → reason: <reason>
Status: complete | in-progress | blocked (<reason>)
```

---

### Diff & Audit Report Format (End of Each Phase)

```
╔══════════════════════════════════════════════╗
║           DIFF & AUDIT REPORT                ║
║  Stage <N> — <Stage Name>                    ║
╚══════════════════════════════════════════════╝

### Files Changed
| Action   | File                     | Lines Δ   | Plan Item |
|----------|--------------------------|-----------|-----------|
| Modified | src/content/pageagent.js | +25 / -4  | §2.1      |
| Created  | src/content/page/bridge.js| +60      | §2.2      |

### Diff Summary
<output of git diff --stat>

### Key Architectural Rationale
- <explanation of why, not what>

### Test Status
- Tests: <command run> | Passed: <n> | Failed: <n>
```

---

## 8. Quick Reference: Commands

```bash
# 1. Build Extension
npm run build

# 2. Run Built-in Unit Tests
npm test

# 3. Serve Test Fixtures (Port 8422)
npm run fixture && npm run serve

# 4. Run Edge Playwright Probe (Node.js, playwright-core)
node _scratch/probe_edge_test.mjs

# 5. Manual Smoke Test on Microsoft Edge
microsoft-edge-stable --user-data-dir=$(mktemp -d /tmp/edge-XXXXXX) --load-extension=./dist http://localhost:8422/test/fixtures/index.html
```
