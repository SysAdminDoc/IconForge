# Research - IconForge

## Executive Summary
IconForge is a dependency-free static browser PWA for generating favicons, PWA icons, extension icons, Android/iOS assets, Windows tiles, social preview images, snippets, and deployable ZIPs entirely client-side. [Verified] Its strongest current shape is privacy-preserving, offline-capable platform export: the current code already covers the broad parity set from RealFaviconGenerator, favicons, pwa-asset-generator, Icon Kitchen, Maskable.app, favicon.io, and Squoosh while avoiding uploads and runtime packages. [Verified] Highest-value next work is: 1) fix the generated SVG favicon contract, 2) add deployment base-path and checksum cache-busting controls, 3) harden canvas/SVG encoder failure paths, 4) add browser-driven artifact verification, 5) complete Android density buckets, 6) refresh Apple/PWA splash device data, 7) add manifest `id` and monochrome icon support, 8) expose lossy codec quality controls, 9) finish ARIA tab semantics, and 10) add installed-PWA file handling and draft recovery.

## Product Map
- Core workflows: upload/paste/text/emoji source -> crop/process -> choose preset/formats -> generate -> validate -> download ZIP/save folder/copy snippets.
- Core workflows: replacement-template folder/ZIP import -> filename matching -> export only matching generated assets plus support files and manifest.
- User personas: web developers, PWA builders, browser extension authors, Android/iOS developers, and designers who need local handoff assets without uploading source art.
- Platforms and distribution: static `index.html`, `styles.css`, `app.js`, `sw.js`, `manifest.webmanifest`, `icon.png`; GitHub Pages; installable PWA; no package manager, build step, runtime dependencies, telemetry, or server.
- Key integrations and data flows: FileReader/Image/canvas input, crop canvas, optional OffscreenCanvas worker path, Blob URL previews, custom STORE-mode ZIP writer, Web Crypto SHA-256 export manifest, File System Access API save-to-folder when available.

## Competitive Landscape
- RealFaviconGenerator: does deployment confidence and platform checking well. Learn from its checker/audit workflow; avoid server-upload dependency and legacy platform clutter.
- itgalaxy/favicons: does data-driven platform options, cache-busting configuration, manifest metadata, and release cadence well. Learn from explicit output configuration; avoid dependency/CVE burden and build-pipeline-only UX.
- pwa-asset-generator: does PWA icon/splash generation and current device churn handling well. Learn from its Apple fallback data updates; avoid making Node the primary path.
- Icon Kitchen and Maskable.app: do adaptive/maskable icon visualization well. Learn from density-safe previews and mask confidence checks; avoid narrowing IconForge to a single mobile-only workflow.
- favicon.io and RedKetchup: do quick text/emoji/favicon handoff well. Learn from fast first-run UX; avoid their narrow platform/export coverage.
- Squoosh: does local codec controls, size feedback, and worker-backed image processing well. Learn from visible quality/size tradeoffs; avoid heavy WASM codecs unless the existing blocked dependency decision changes.
- Astro and webpack PWA icon plugins: reveal common framework deployment pain around base paths and icon output paths. Learn from framework-specific path configurability; avoid framework lock-in.

## Security, Privacy, and Reliability
- [Verified] The current tree has no package manifests or runtime dependencies; dependency CVE exposure is limited compared with generator packages that carry Puppeteer/Rollup/XML tooling.
- [Verified] Baseline checks pass locally with direct Node: `node -c app.js`, `node -c sw.js`, `node tests/export-regression.test.js`, `node tests/a11y-labels.test.js`, and `node tests/csp-shell.test.js`.
- [Verified] Rendered smoke at `http://127.0.0.1:8773/index.html` loaded, generated the Social Preview preset from text input, produced 3 files, passed export validation, rendered diagnostics, had no console warnings/errors, and had no desktop or 390px mobile horizontal overflow.
- [Verified] Generated SVG favicon output is not self-contained: `app.js:1635-1654` reads selected light/dark colors but emits `<link rel="stylesheet" href="styles.css">` and no embedded dark-mode style, while `README.md` claims SVG dark-mode CSS.
- [Verified] Snippets and manifests assume root-relative URLs via `hrefFor()` and `webManifestHref()` in `app.js:2072-2074` and `app.js:2301-2304`; this breaks subpath deployments and prevents checksum query cache-busting despite `iconforge-export.json` hashes.
- [Verified] Canvas encoders are not fail-closed: `app.js:1781-1785` resolves `canvas.toBlob(...)` without checking for `null`, then `app.js:1796-1804` dereferences `blob.size`. MDN documents `SecurityError`/origin-clean failure behavior for canvas exports.
- [Verified] SVG input is accepted through `accept="image/*,.svg"` and `loadImage()` at `app.js:997-1070`; malformed, oversized, or externally-referencing SVGs need clearer diagnostics and no-crash handling before canvas export.
- [Verified] Android export currently emits only `mipmap-xxxhdpi` foreground/background/legacy PNGs at `app.js:1945-1960`; Android adaptive icon tooling expects density-aware assets.
- [Likely] PWA splash data is stale-prone: `PWA_SPLASH_SPECS` in `app.js:1902-1908` contains six fixed devices, while pwa-asset-generator and favicons issue trackers show ongoing Apple-device update churn.
- [Verified] Recovery is good for service-worker updates, but app session state is volatile: the update notice can reload the app, while source/settings/crop state are not persisted across accidental refreshes.

## Architecture Assessment
- The zero-dependency split shell is the right boundary: `index.html` owns markup, `styles.css` owns presentation, `app.js` owns builders/rendering/export, and tests load the exposed `window.__ICONFORGE_TEST__` API.
- Refactor candidates: centralize deployment URL construction around `hrefFor()`/`webManifestHref()`; make SVG generation self-contained; extract platform spec arrays (`PWA_SPLASH_SPECS`, Android densities, manifest purposes) into testable data objects inside `app.js`.
- Test gaps: current Node tests verify pure builders and metadata, but do not decode real browser-generated PNG dimensions, exercise real canvas encoder failure, verify mobile generated-output layout, or test ZIP payloads from a rendered browser run.
- Accessibility gap: snippet tabs use `role="tablist"`/`role="tab"` in `index.html:568-587` but lack `aria-controls`, tabpanel linkage, and standard arrow/Home/End tablist behavior from the WAI-ARIA Authoring Practices.
- Observability gap: diagnostics are visible in-app, but there is no copy/download support bundle for browser support, preset, validation checks, encoder path, and app version without source image bytes.
- Documentation gap: README describes capabilities, but exact generated folder/file contracts live only in tests and code; future implementation should generate or validate the contract in-app instead of adding another markdown file.

## Rejected Ideas
- Server-side processing or hosted URL fetch: source is commercial/favicon checker behavior; rejected because uploads and remote fetches weaken IconForge's local privacy differentiator and increase CORS/canvas-taint risk.
- Heavy WASM codecs or PNG quantization by default: source is Squoosh/image optimizer tooling; rejected for now because `Roadmap_Blocked.md` already parks the dependency-size decision.
- ML background removal: source is adjacent image tooling; rejected because model size/licensing is already a product/dependency decision in `Roadmap_Blocked.md`.
- Device chrome mockups: source is Icon Kitchen and Maskable.app; rejected because `Roadmap_Blocked.md` already parks visual asset and device-matrix decisions.
- Headless CLI, package plugin, or hosted API: source is pwa-asset-generator, favicons, Astro, webpack plugins, and Squoosh API requests; rejected because the separate package design is already blocked and the primary product is a browser PWA.
- Multi-user accounts, cloud projects, or team asset libraries: source is commercial brand tooling; rejected because accounts contradict the single-session, no-upload privacy model.
- Full UI translation now: source is global web-tool usage; rejected as a near-term item because manifest `lang`/`dir` is already implemented and deployment correctness/accessibility have higher verified impact. A string catalog can be considered later without shipping translations.
- Migration framework: source is app-state tooling patterns; rejected because IconForge currently has no persisted project schema beyond optional future draft recovery.

## Sources
Competitors and analogous projects:
- https://realfavicongenerator.net/
- https://favicon.io/
- https://redketchup.io/favicon-generator
- https://icon.kitchen/
- https://maskable.app/
- https://github.com/elegantapp/pwa-asset-generator
- https://github.com/itgalaxy/favicons
- https://github.com/GoogleChromeLabs/squoosh
- https://github.com/ACP-CODE/astro-favicons
- https://github.com/arthurbergmz/webpack-pwa-manifest

Standards and platform docs:
- https://www.w3.org/TR/appmanifest/
- https://web.dev/articles/add-manifest
- https://web.dev/articles/maskable-icon
- https://developer.chrome.com/docs/extensions/reference/manifest/icons
- https://developer.android.com/develop/ui/views/launch/icon_design_adaptive
- https://developer.apple.com/design/human-interface-guidelines/app-icons
- https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP
- https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker
- https://developer.chrome.com/docs/capabilities/web-apis/file-handling
- https://www.w3.org/WAI/ARIA/apg/patterns/tabs/
- https://ogp.me/

Community and issue signals:
- https://stackoverflow.com/questions/2208933/how-do-i-force-a-favicon-refresh
- https://github.com/itgalaxy/favicons/issues/461
- https://github.com/itgalaxy/favicons/issues/456
- https://github.com/itgalaxy/favicons/issues/452
- https://github.com/itgalaxy/favicons/issues/450
- https://github.com/elegantapp/pwa-asset-generator/issues/1274
- https://github.com/ACP-CODE/astro-favicons/issues/92
- https://github.com/arthurbergmz/webpack-pwa-manifest/issues/173

## Open Questions
- None that block the current research-driven roadmap.
