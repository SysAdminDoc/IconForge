# Research - IconForge

## Executive Summary
IconForge is a zero-dependency static browser PWA for generating favicons, PWA icons, extension icons, Android/iOS icon bundles, Windows tiles, snippets, and deployable ZIPs entirely client-side. Its strongest current shape is privacy-preserving platform bundle export: v0.4.0 already covers the biggest parity gap against RealFaviconGenerator, pwa-asset-generator, favicons, Icon Kitchen, and favicon.io. v0.4.1 adds a dependency-free export regression harness and removes the duplicate snippet builder. v0.4.2 adds local export validation after generation. v0.4.3 adds visible service-worker update recovery. v0.4.4 closes the verified visible-label gap. v0.4.5 adds user-controlled manifest metadata including language and direction fields. v0.4.6 splits CSS/JS into local files and adds a strict runtime CSP. v0.4.7 adds browser/generation diagnostics after export. v0.4.8 adds framework-ready handoff snippets for plain HTML, Vite, Next.js, Astro, MV3 extensions, Android, and iOS. v0.4.9 adds checksum-backed export manifests. v0.4.10 adds optional social preview assets with meta tags. The current research-driven roadmap has been drained; the highest-value next direction is broader browser-driven preset coverage and image-dimension decoding tests.

## Product Map
- Core workflows: upload/paste/text/emoji source -> crop/process -> select preset/formats -> generate -> download/save/copy snippets.
- Core workflows: replacement-template import from folder or ZIP filename map -> generate only matching output filenames.
- User personas: web developers, PWA builders, browser extension developers, mobile app developers, designers who need fast local icon handoffs.
- Platforms and distribution: static `index.html`, `sw.js`, `manifest.webmanifest`, `icon.png`; GitHub Pages; installable PWA; no package manager or runtime dependencies.
- Key integrations and data flows: FileReader/Image/canvas input; Web Worker and OffscreenCanvas resize path; Blob URL previews; custom STORE-mode ZIP writer; File System Access API when available.

## Competitive Landscape
- RealFaviconGenerator: does checker-driven favicon/PWA validation and mature per-platform output well. Learn from its audit workflow and deployment confidence checks; avoid server upload dependency and obsolete platform clutter.
- pwa-asset-generator: does manifest and HTML file mutation for PWA icons/splash assets well. Learn from its spec-driven output declarations; avoid requiring Node for IconForge's primary browser workflow.
- itgalaxy/favicons: does platform specification data, TypeScript configuration, and broad ecosystem integration well. Learn from its explicit platform options and generated metadata; avoid server/build-pipeline-only UX.
- favicon.io: does text/emoji-to-favicon simplicity well. Learn from the focused "generate then paste these tags" handoff; avoid its narrow format/platform coverage.
- Icon Kitchen: does adaptive icon previews, safe-zone visualization, and foreground/background thinking well. Learn from confidence-building previews; avoid narrowing IconForge to mobile-only icons.
- Maskable.app: does mask-shape and safe-area visualization well. Learn from stricter maskability validation; avoid single-purpose scope.
- Squoosh: does local browser image processing, codec feature disclosure, and worker-based processing well. Learn from visible codec/quality diagnostics; avoid heavy WASM codecs unless a product decision explicitly accepts dependency size.
- Astro/webpack/PWA icon generators: do framework-ready placement and configuration well. Learn from framework-specific output paths and snippets; avoid framework lock-in.

## Security, Privacy, and Reliability
- Verified: no runtime dependencies and no processing uploads are part of the repo design (`README.md`); keep this as the product constraint for future work.
- Verified: the live generation path at `http://127.0.0.1:8765/index.html` generated a PWA text-icon bundle with no console warnings/errors. v0.4.1 now protects the pure export builders with `tests/export-regression.test.js`.
- Verified fixed in v0.4.1: two same-scope `generateSnippets()` declarations existed in `index.html:3665` and `index.html:3800`; only one active snippet entry point remains.
- Verified in v0.4.2 at `http://127.0.0.1:8766/index.html`: the generated-output flow now renders a local validation panel with pass/warn/fail checks for selected platform files, dimensions, manifest icon metadata, support files, and maskable safe-zone coverage.
- Verified fixed in v0.4.5: `buildManifestSnippet()` now uses local manifest metadata controls for name, short name, description, start URL, scope, display, categories, theme/background colors, shortcuts, screenshots, `lang`, and `dir`, with tests covering default, edited, and optional values.
- Verified fixed in v0.4.3: `sw.js` uses network-first HTML and cache cleanup, and `index.html` now shows a non-blocking reload notice when a new service worker is waiting or has activated in the background.
- Verified fixed in v0.4.6: `index.html` now references local `styles.css` and `app.js`, removes runtime external font/raw-image dependencies, and carries a CSP meta policy that keeps scripts/styles self-hosted while allowing blob/data image and worker capabilities.
- Verified fixed in v0.4.7: generated output now includes a diagnostics panel listing browser feature support, selected preset/formats, skipped or hidden formats, worker fallback state, generated file count, total bytes, and validation status.
- Verified fixed in v0.4.8: generated output now includes tabbed handoff snippets for plain HTML, Vite, Next.js app router, Astro, Chrome/Firefox MV3, Android, and iOS, with paths derived from the active generated export.
- Verified fixed in v0.4.9: ZIP and folder exports include `iconforge-export.json` with app version, preset, source mode, options, file inventory, dimensions, MIME types, byte sizes, and SHA-256 hashes.
- Verified fixed in v0.4.10: the optional Social Preview preset exports Open Graph, Twitter, and LinkedIn PNG assets with copyable meta tags and deployable support files.
- Verified fixed in v0.4.4: `#textInput`, `#fontSelect`, `#customWidth`, and `#customHeight` now have programmatic labels, with `tests/a11y-labels.test.js` covering visible form controls.
- Verified: mobile viewport 390x844 showed no horizontal overflow in the initial state; keep mobile regression checks focused on generated output/snippet sections and crop controls.

## Architecture Assessment
- The split `app.js` remains dependency-free and keeps the pure builder/test seam without adding a bundler.
- `generatePlatformBundle()` at `index.html:3485`, `generatePwaBundle()` at `index.html:3497`, `generateAndroidBundle()` at `index.html:3533`, `IOS_ICON_SPECS` at `index.html:3551`, and `addOutputItem()` at `index.html:3597` are the highest-value regression targets.
- The in-app snippets now cover generic and framework-specific handoffs while staying dependency-free; future snippet work should focus on making any new output contract test-generated rather than manually documented.
- Testing baseline: `tests/export-regression.test.js` verifies ZIP central directory output, ICO headers, platform filenames, generated manifest/snippet support files, diagnostics output, framework handoff snippets, social preview snippets, export manifest checksums, replacement-template matching, and export validator pass/fail cases. `tests/a11y-labels.test.js` verifies visible form-control labels. Remaining tests should expand into browser-driven preset coverage and generated image dimension decoding.
- Documentation gap: README describes features well, but there is no generated-output contract describing exact folders/files per preset. That contract should be generated in-app and covered by tests rather than maintained as another doc file.

## Rejected Ideas
- Server-side processing or hosted URL fetch: source is competitor behavior; rejected because it weakens the no-upload privacy differentiator and risks CORS/canvas tainting.
- Heavy WASM codecs or PNG quantization by default: source is Squoosh and image-optimizer tools; rejected for now because dependency size contradicts the zero-dependency constraint already recorded in `Roadmap_Blocked.md`.
- ML background removal: source is adjacent image tools; rejected for this pass because model size/licensing is already a product decision in `Roadmap_Blocked.md`.
- Device chrome mockups: source is Icon Kitchen and Maskable.app; rejected for the actionable roadmap because visual asset/device-matrix decisions are already parked in `Roadmap_Blocked.md`.
- Headless CLI/package: source is pwa-asset-generator, favicons, Astro and webpack plugins; rejected for this pass because the separate package design is already parked in `Roadmap_Blocked.md`.
- Multi-user/project accounts: source is commercial asset-management tools; rejected because IconForge is a local single-session utility and accounts would contradict the privacy-first browser model.
- Full UI translation project: source is global web tooling usage; rejected as a near-term item because deployment correctness and accessibility issues have higher verified impact. Manifest `lang`/`dir` support is now covered by the generated-manifest metadata controls.
- Windows tile expansion beyond current output: source is legacy favicon generators; rejected because current Windows support is enough and modern demand is lower than PWA/extension/mobile correctness.

## Sources
Competitors and analogous projects:
- https://realfavicongenerator.net/
- https://favicon.io/
- https://icon.kitchen/
- https://maskable.app/
- https://redketchup.io/favicon-generator
- https://github.com/elegantapp/pwa-asset-generator
- https://github.com/itgalaxy/favicons
- https://github.com/rexxars/create-favicon
- https://github.com/GoogleChromeLabs/squoosh
- https://github.com/ACP-CODE/astro-favicons
- https://github.com/arthurbergmz/webpack-pwa-manifest
- https://github.com/alonw0/web-asset-generator

Standards and platform docs:
- https://web.dev/articles/add-manifest
- https://web.dev/articles/maskable-icon
- https://www.w3.org/TR/appmanifest/
- https://developer.chrome.com/docs/extensions/reference/manifest/icons
- https://developer.android.com/develop/ui/views/launch/icon_design_adaptive
- https://developer.apple.com/design/human-interface-guidelines/app-icons
- https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob
- https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas/convertToBlob
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP
- https://www.w3.org/TR/WCAG22/#dragging-movements

Community and operations:
- https://stackoverflow.com/questions/2208933/how-do-i-force-a-favicon-refresh
- https://developer.chrome.com/docs/lighthouse/pwa/
- https://developer.chrome.com/docs/workbox/handling-service-worker-updates

## Open Questions
