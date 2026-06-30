# IconForge Roadmap

No actionable roadmap items remain after the v0.4.10 research-driven drain.

Blocked or product-gated items live in `Roadmap_Blocked.md`.

## Research-Driven Additions

### P0

- [ ] P0 — Fix generated SVG favicon contract
  Why: README promises embedded dark-mode SVG behavior, but generated SVG links `styles.css` and ignores selected light/dark colors.
  Evidence: `app.js:1635-1654`; `README.md`; self-contained favicon expectations from favicon generators.
  Touches: `app.js`; `tests/export-regression.test.js`; `README.md`
  Acceptance: SVG output contains inline style using selected light/dark colors, has no external `<link>`, exports correctly in ZIP/folder flows, and regression tests assert the self-contained contract.
  Complexity: S

- [ ] P0 — Add deployment base-path and checksum cache-busting controls
  Why: Generated snippets assume root-relative URLs, which breaks subpath/CDN/framework deployments and leaves favicon cache refresh work manual despite export hashes.
  Evidence: `app.js:2072-2074`; `app.js:2301-2304`; StackOverflow favicon refresh thread; itgalaxy/favicons#461; astro-favicons#92; webpack-pwa-manifest#173.
  Touches: `app.js`; `index.html`; `tests/export-regression.test.js`; `README.md`
  Acceptance: User can choose root-relative, relative, or custom asset base URL plus optional `?v=<sha256-8>` cache query; HTML, manifest, social, framework, extension, Android, iOS, Windows snippets, support files, validation, and tests all use the selected URL policy.
  Complexity: M

- [ ] P0 — Guard canvas encoder failures and SVG/image input errors
  Why: `canvas.toBlob()` can fail or return no blob, and malformed or externally-referencing SVG input can currently collapse into generic generation errors.
  Evidence: `app.js:997-1070`; `app.js:1749-1785`; `app.js:1796-1804`; MDN `HTMLCanvasElement.toBlob()` security/error behavior.
  Touches: `app.js`; `tests/export-regression.test.js`
  Acceptance: Canvas and worker encoder paths verify non-empty blobs before registration; malformed/tainted SVG fixtures show a clear status and diagnostics entry without crashing; regression coverage proves no file with a missing blob reaches export.
  Complexity: M

### P1

- [ ] P1 — Add browser-driven preset artifact verification
  Why: Node tests cover pure builders, but they do not exercise real canvas output, browser encoder behavior, PNG dimensions, mobile generated-output layout, or ZIP payloads from the rendered app.
  Evidence: `tests/export-regression.test.js`; rendered Social Preview smoke at `http://127.0.0.1:8773/index.html`; current validation functions in `app.js:2660-2910`.
  Touches: `tests/`; `app.js`; `index.html`
  Acceptance: A local browser smoke generates Modern Web, PWA, Android, iOS, Windows, and Social Preview presets from a text source, decodes output dimensions/ICO entries/ZIP names, checks validation and diagnostics, verifies desktop plus 390px mobile no-overflow, and reports no console warnings/errors.
  Complexity: M

- [ ] P1 — Generate complete Android adaptive icon density buckets
  Why: Current Android preset emits only `mipmap-xxxhdpi`, while Android adaptive icon handoffs normally need density-aware foreground/background/legacy assets.
  Evidence: `app.js:1945-1960`; Android adaptive icon documentation; Icon Kitchen adaptive icon workflow.
  Touches: `app.js`; `tests/export-regression.test.js`; `README.md`
  Acceptance: Android export includes mdpi, hdpi, xhdpi, xxhdpi, and xxxhdpi foreground/background/legacy PNGs plus XML that references the correct resources; validation and handoff snippets enumerate the full density set.
  Complexity: M

- [ ] P1 — Refresh PWA and Apple splash device data
  Why: Fixed splash specs cover only six older devices, and competitor issue trackers show Apple-device asset matrices require recurring updates.
  Evidence: `app.js:1902-1908`; pwa-asset-generator#1274; itgalaxy/favicons#450.
  Touches: `app.js`; `tests/export-regression.test.js`; `README.md`
  Acceptance: Splash specs are data-driven, current through the latest public iPhone/iPad sizes used by comparable generators, validation names every generated splash dimension, and tests fail when expected splash files drift.
  Complexity: M

- [ ] P1 — Add manifest `id` and monochrome icon purpose support
  Why: The manifest UI covers many fields, but not `id` or optional monochrome icon purpose; competitor issues show demand for both.
  Evidence: `app.js:2092-2190`; W3C Web App Manifest; itgalaxy/favicons#452; itgalaxy/favicons#456.
  Touches: `index.html`; `app.js`; `tests/export-regression.test.js`; `README.md`
  Acceptance: Manifest metadata supports optional `id`; exports can include a monochrome icon entry when enabled; validation checks `src`, `sizes`, `type`, and `purpose`; regression tests cover omitted and populated fields.
  Complexity: M

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
