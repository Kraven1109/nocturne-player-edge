# Contributing

Thanks for taking a look.

## Setup

```bash
npm ci
npm run lint && npm test
```

Git hooks are installed automatically: staged files are linted and formatted,
commit messages are checked, and tests run before a push.

## Rules that are not negotiable

This extension makes one promise — it collects nothing and talks to nobody. Any
change that adds a network call, a sensor API, `eval`, `storage.sync`, or a new
manifest permission will fail `npm run lint:privacy` in CI. If you believe a
change genuinely needs one, open an issue first.

Everything else: keep the shipped bundle unminified, and keep new dependencies
out of the extension itself (build-time only).

## Style

`eslint-config-metarhia` plus Prettier, 80 columns. Prefer code that reads
without comments; comment only what the code cannot say.

## Commits & Naming Convention

[Conventional Commits](https://www.conventionalcommits.org), lower case, 72
characters max:

```
feat(gestures): add vertical dim and volume swipe
fix(detect): rank videos by visible area
```

Allowed scopes are listed in `commitlint.config.js`. Code conventions:

- DOM markers use `data-nocturne*`; Shadow DOM state classes use `is-*` (`is-open`,
  `is-dragging`, `is-visible`).
- Cross-world CustomEvent bridge uses `nocturne:req` / `nocturne:res`.
- Boolean settings keys follow `is<Feature>On` / `are<Plural><Adj>`; numeric
  settings must declare bounds in `RANGES` inside `src/lib/settings.js`.
- If editing `src/icons/icon.svg`, regenerate PNG icons with `npm run icons`.

## Testing a change

Pure helpers and DOM/state units get a test in `test/unit/`. Browser and
bridge behavior is verified against Microsoft Edge via Playwright:

```bash
npm run build
npm run validate:mv3
npm run lint && npm test
npm run test:e2e
```

For manual testing in a clean Edge profile:

```bash
npm run fixture && npm run serve &
npm start
```
