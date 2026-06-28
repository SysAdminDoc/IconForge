# Research - IconForge

## Executive Summary
IconForge is a zero-dependency static browser PWA for generating favicons, PWA icons, extension icons, Android/iOS icon bundles, Windows tiles, snippets, and deployable ZIPs entirely client-side. Its strongest current shape is privacy-preserving platform bundle export: v0.4.0 already covers the biggest parity gap against RealFaviconGenerator, pwa-asset-generator, favicons, Icon Kitchen, and favicon.io. The highest-value direction is trust and deployment correctness, not more raw output formats. Top opportunities: add automated regression coverage for ZIP/ICO/manifest/platform bundle builders; remove the duplicate `generateSnippets()` implementation; add a local export validator/checker; improve generated manifest metadata; add a visible PWA update/recovery flow; harden with a CSP-compatible script split; fix unlabeled controls found in the live UI pass; add framework-specific handoff snippets; add diagnostics for browser feature support and generation decisions.

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
- Verified: the live generation path at `http://127.0.0.1:8765/index.html` generated a PWA text-icon bundle with no console warnings/errors, but there is no automated test that protects this behavior.
- Verified: two same-scope `generateSnippets()` declarations exist in `index.html:3665` and `index.html:3800`; the second overrides the first, leaving dead snippet logic that can confuse future edits.
- Verified: `buildManifestSnippet()` in `index.html:3734` emits icon metadata plus basic name/colors only; current manifest specs and PWA guidance support richer deployment metadata such as description, start URL, scope, display, categories, shortcuts, screenshots, and language/direction where relevant.
- Verified: `sw.js` uses network-first HTML and cache cleanup, but `index.html:4064` registers the service worker silently; installed users get no visible "new version available" or recovery prompt.
- Verified: the app has no CSP. Because `index.html` currently contains large inline CSS/JS plus Blob workers (`index.html:3109`), adding a meaningful CSP requires either a script/style split or a carefully documented policy.
- Verified: live DOM audit found unlabeled visible controls: `#textInput`, `#fontSelect`, `#customWidth`, and `#customHeight`. Related markup is in `index.html:1499`, `index.html:1502`, and `index.html:1671`.
- Verified: mobile viewport 390x844 showed no horizontal overflow in the initial state; keep mobile regression checks focused on generated output/snippet sections and crop controls.
- Missing guardrail: generated ZIPs include support files from `getSupportFiles()` (`index.html:3868`) but no machine-readable export manifest/checksum report for support/debugging.
- Recovery need: failed generation paths use status text, but there is no diagnostic export containing browser support flags, selected preset, skipped formats, worker fallback state, or generated file list.

## Architecture Assessment
- The single inline script remains workable but is now large enough that core pure functions need a test seam. Best first step: extract pure builders (`buildZip`, `createICO`, platform filename/spec builders, snippet/manifest builders, template matching) into a small global namespace or separate `app.js` without adding a bundler.
- `generatePlatformBundle()` at `index.html:3485`, `generatePwaBundle()` at `index.html:3497`, `generateAndroidBundle()` at `index.html:3533`, `IOS_ICON_SPECS` at `index.html:3551`, and `addOutputItem()` at `index.html:3597` are the highest-value regression targets.
- The in-app snippets are useful but generic. Competitors with framework plugins show demand for path-specific handoff; IconForge can stay dependency-free by generating copyable snippets for plain HTML, Vite, Next.js app router, Astro, Chrome/Firefox MV3, Android, and iOS.
- Testing gap: no repository test suite exists. The current syntax check (`node -c` on extracted inline script) catches parse errors only; it does not verify ZIP validity, ICO headers, manifest schema, file names, or UI generation.
- Documentation gap: README describes features well, but there is no generated-output contract describing exact folders/files per preset. That contract should be generated in-app and covered by tests rather than maintained as another doc file.

## Rejected Ideas
- Server-side processing or hosted URL fetch: source is competitor behavior; rejected because it weakens the no-upload privacy differentiator and risks CORS/canvas tainting.
- Heavy WASM codecs or PNG quantization by default: source is Squoosh and image-optimizer tools; rejected for now because dependency size contradicts the zero-dependency constraint already recorded in `Roadmap_Blocked.md`.
- ML background removal: source is adjacent image tools; rejected for this pass because model size/licensing is already a product decision in `Roadmap_Blocked.md`.
- Device chrome mockups: source is Icon Kitchen and Maskable.app; rejected for the actionable roadmap because visual asset/device-matrix decisions are already parked in `Roadmap_Blocked.md`.
- Headless CLI/package: source is pwa-asset-generator, favicons, Astro and webpack plugins; rejected for this pass because the separate package design is already parked in `Roadmap_Blocked.md`.
- Multi-user/project accounts: source is commercial asset-management tools; rejected because IconForge is a local single-session utility and accounts would contradict the privacy-first browser model.
- Full UI translation project: source is global web tooling usage; rejected as a near-term item because deployment correctness and accessibility issues have higher verified impact. Add manifest `lang`/`dir` support first.
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
- Verified blocker: should richer manifest metadata be user-entered per export, persisted locally, or derived from the source filename with optional overrides?
- Verified blocker: should CSP hardening preserve a single-file app, or is a two-file `index.html` plus `app.js` structure acceptable for the next release?
