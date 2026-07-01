# IconForge Roadmap

No actionable roadmap items remain after the v0.4.10 research-driven drain.

Blocked or product-gated items live in `Roadmap_Blocked.md`.

## Research-Driven Additions

### P2

- [ ] P2 — Add lossy codec quality and size-budget controls
  Why: JPG/WebP/AVIF paths hardcode quality at 0.92, while image tools like Squoosh expose quality/size tradeoffs users expect before export.
  Evidence: `app.js:1471-1490`; `app.js:1749-1785`; Squoosh codec workflow and AVIF/JXL issue signals.
  Touches: `index.html`; `app.js`; `styles.css`; `tests/export-regression.test.js`
  Acceptance: Users can set JPG/WebP/AVIF quality and optional target-size warnings; diagnostics and export manifest record quality; generated output displays before/after byte impact; tests cover default and edited quality.
  Complexity: M

- [ ] P2 — Complete ARIA tab semantics for snippet handoffs
  Why: Snippet tabs expose tab roles but lack full tabpanel relationships and standard tablist navigation semantics.
  Evidence: `index.html:568-587`; WAI-ARIA Authoring Practices tabs pattern; `tests/a11y-labels.test.js`.
  Touches: `index.html`; `app.js`; `tests/a11y-labels.test.js`
  Acceptance: Each snippet tab has stable `id`, `aria-controls`, and linked tabpanel metadata; arrow/Home/End navigation follows the ARIA tabs pattern without adding app-wide shortcuts; accessibility tests cover the relationships.
  Complexity: S

- [ ] P2 — Add copy/download diagnostics support JSON
  Why: Diagnostics are visible but not shareable, making bug reports harder without telemetry.
  Evidence: `app.js:349-419`; `app.js:2621-2642`; rendered diagnostics panel.
  Touches: `index.html`; `app.js`; `styles.css`; `tests/export-regression.test.js`
  Acceptance: Diagnostics panel can copy/download JSON containing app version, browser support, preset, selected formats, validation checks, worker fallback state, and encoder errors without including source image bytes.
  Complexity: S

- [ ] P2 — Preserve draft state across reloads
  Why: Installed/offline users can lose selected source mode, processing settings, crop values, and metadata after a service-worker update reload or accidental refresh.
  Evidence: `sw.js:1-34`; update notice flow in `app.js:3113-3159`; no localStorage/IndexedDB draft persistence in source scan.
  Touches: `app.js`; `index.html`; `tests/export-regression.test.js`
  Acceptance: Recent non-sensitive settings and optional local source image draft restore after reload with a visible reset action; privacy copy explains data stays local; service-worker reload preserves the draft when enabled.
  Complexity: M

- [ ] P2 — Add installed-PWA file handling for image files
  Why: IconForge is an installable local image utility, and file handling lets installed PWAs open image files directly into the app.
  Evidence: `manifest.webmanifest`; `app.js:997-1070`; Chrome File Handling API documentation.
  Touches: `manifest.webmanifest`; `app.js`; `sw.js`; `README.md`
  Acceptance: Installed Chrome/Edge PWA declares image file handlers, launch handling imports the selected file through the existing `loadImage()` path, unsupported browsers keep the current upload/drop workflow, and diagnostics reports file-handling support.
  Complexity: L

### P3

- [ ] P3 — Introduce a UI string catalog before localization
  Why: Manifest `lang`/`dir` export exists, but the app UI is hard-coded English; a catalog is the prerequisite for future translations without changing behavior now.
  Evidence: `index.html`; `app.js`; W3C Web App Manifest language/direction support.
  Touches: `index.html`; `app.js`; `tests/a11y-labels.test.js`
  Acceptance: User-visible strings used by the shell, statuses, diagnostics, validation, snippets, and errors flow through a single catalog while default English output remains unchanged and tests still pass.
  Complexity: L
