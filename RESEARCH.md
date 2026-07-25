# Research — IconForge
Date: 2026-07-25 — replaces all prior research.

## Executive Summary

IconForge v0.4.23 is a static, client-only PWA for turning an uploaded, pasted, typed, or emoji source into favicon, web, PWA, browser-extension, Android, iOS, Windows, and social-preview bundles. Its strongest current shape is a privacy-preserving, zero-build workflow with real ZIP/ICO/PNG/SVG outputs, framework snippets, deployment URL controls, export hashes, diagnostics, draft recovery, and browser smoke coverage (`README.md`, `app.js:77`, `app.js:1542-1582`, `app.js:3558-3660`, `tests/browser-preset-smoke.py`). The highest-value direction is not another platform preset: it is making every generated artifact and deployment snippet provably safe and platform-correct, then making offline recovery, failure handling, accessibility, and release/spec drift testable. Confidence is Verified for repository behavior, Likely for standards-based fixes, and Needs live validation for actual iOS/Android/Safari rendering.

1. **P0 — Secure deployment output.** Reject non-HTTP(S)/relative custom bases and HTML/XML-escape every generated attribute; a browser check reproduced `javascript:` output and an unescaped closing quote/script in `app.js:2965-3017`.
2. **P0 — Make offline launch deterministic.** Pre-cache the shell and provide a navigation fallback; `sw.js:3-8,27-47` omits `index.html`, while the product explicitly promises an offline PWA (`README.md`).
3. **P0 — Validate bytes, not declarations.** Decode actual output dimensions, MIME/signatures, ICO entries, manifest references, and purpose semantics; the current validator trusts metadata and only the happy-path Chromium smoke decodes selected files (`app.js:3695-3944`, `tests/browser-preset-smoke.py`).
4. **P0 — Correct Apple startup assets.** Model CSS point dimensions, scale factors, orientation, and current device data instead of using raw raster pixels in media queries (`app.js:2759-2780,3502-3504`; [Apple HIG](https://developer.apple.com/design/human-interface-guidelines/images), [pwa-asset-generator](https://github.com/elegantapp/pwa-asset-generator)).
5. **P0 — Make maskable and monochrome real.** Validate the 40% maskable safe zone against pixels and generate a true alpha/silhouette monochrome asset; the current warning is unreachable and the monochrome purpose reuses a color PNG (`app.js:3220-3231,3918-3931`; [Web App Manifest](https://www.w3.org/TR/appmanifest/)).
6. **P1 — Fail closed on metadata and encoder errors.** Malformed shortcuts currently still produce a valid-looking manifest snippet, and worker/toBlob failures can wait for a 30-second timeout (`app.js:2311-2370,2336-2355,3226-3241`).
7. **P1 — Make large exports observable and recoverable.** PWA generation produces 54 files/approximately 3.16 MB in the current smoke run, but there is no stage progress, cancellation, or batch folder rollback (`app.js:2483-2567,4034-4060`).
8. **P1 — Complete the accessibility and release contracts.** Source-mode buttons lack tab semantics/keyboard behavior, muted text measures about 4.12:1 against the dark background, and version/spec data are duplicated across files (`index.html:42-46`, `styles.css:10,85-91`, `app.js:77`, `sw.js:1`).

## Product Map

### Core workflows

- Ingest: drag/drop, file picker, clipboard paste, text, emoji, and PWA file handling; source image bytes remain local (`index.html:42-216`, `app.js:1422-1434,1851-1875`).
- Prepare: automatic or manual crop, numeric crop controls, padding, resampling, quality/budget, background, effects, pixel hinting, mask preview, and replacement-template matching (`README.md`, `app.js:1908-2277`).
- Generate: named web/PWA/extension/Android/iOS/Windows/social/all presets, standard/custom sizes, PNG/ICO/SVG/JPG/WebP/AVIF feature detection, and worker-backed resizing (`app.js:1542-1582,2281-2567`).
- Handoff: manifest metadata, deployment URL modes, cache busting, HTML/JSON/framework snippets, social tags, ZIP/folder export, and `iconforge-export.json` hashes (`app.js:2965-3660`).
- Recover and inspect: optional local drafts, service-worker update notice, validation summary, diagnostics, support JSON, and installed-file handling (`app.js:718-792,4163-4370`, `README.md`).

### User personas

- Developers shipping a favicon or installable web/PWA bundle without adding a build dependency.
- Designers and small teams producing a source-consistent icon family, social previews, and platform handoff files.
- Privacy-sensitive users who need local processing and offline use. This is a product-fit inference from the explicit browser-only/local/private positioning in `README.md`, not a measured audience claim.

### Platforms and distribution

The artifact is a static website/PWA distributed from any static host; there is no package manager, backend, build step, or native wrapper. The documented browser floor is Chrome/Edge 99+, Firefox 112+, and Safari 16.4+ (`CLAUDE.md`, `README.md`). The current automated browser smoke uses Chromium only, so Firefox/Safari compatibility remains Needs live validation (`tests/browser-preset-smoke.py`).

### Key integrations and data flows

Browser `File`, Clipboard, File System Access, `launchQueue`, Canvas, OffscreenCanvas/Worker, Web Crypto, localStorage, Cache Storage, ZIP, and ICO code paths feed generated in-memory blobs. A custom deployment base is interpolated into snippets and manifests; this is the highest-risk data boundary because the output is intended to be copied into another project (`app.js:2965-3017,3558-3660`). No source image or generated asset is sent to a server in the documented design (`README.md`, `index.html:1-12`).

## Competitive Landscape

- **RealFaviconGenerator** — broad platform coverage, live previews, checker, and copy-ready markup/instructions ([site](https://realfavicongenerator.net/), [repository](https://github.com/RealFaviconGenerator/realfavicongenerator)). Learn: make the generated contract visibly inspectable and explain platform choices. Avoid: hosted upload/processing as the default because local privacy is IconForge’s differentiator.
- **pwa-asset-generator** — spec-aware iOS startup tags, scale-factor/orientation handling, maskable assets, dark-mode inputs, and static fallback data ([repository](https://github.com/elegantapp/pwa-asset-generator)). Learn: keep platform matrices as data with provenance and emit exact media conditions. Avoid: Puppeteer and a growing Node dependency surface in the core browser app.
- **itgalaxy/favicons** — explicit configuration for metadata, cache busting, paths, language/direction, maskable manifest purposes, and platform toggles ([repository](https://github.com/itgalaxy/favicons)). Learn: expose a stable, serializable export configuration. Avoid: making a Node-only tool the primary workflow.
- **app-asset-generator** — broad native platform matrix plus safe-zone validation, dry-run, JSON output, and platform listing ([repository](https://github.com/guillempuche/app-asset-generator)). Learn: add deterministic preflight/list/validate modes to the browser export flow. Avoid: expanding into store-specific native targets before web/PWA correctness is solved.
- **Vite PWA assets/plugin** — zero-config static assets, framework handoff, Workbox strategies, and update behavior ([assets generator](https://github.com/vite-pwa/assets-generator), [plugin](https://github.com/vite-pwa/vite-plugin-pwa)). Learn: offer framework-specific integration and explicit offline/update diagnostics. Avoid: importing Vite/Workbox complexity into a dependency-free single-file app; their current issue queue shows ecosystem/version churn ([issue 923](https://github.com/vite-pwa/vite-plugin-pwa/issues/923)).
- **Squoosh** — local, browser-side codecs, quality controls, and format comparison ([repository](https://github.com/GoogleChromeLabs/squoosh/), [app](https://squoosh-web.pages.dev/)). Learn: expose codec support, quality, and size outcomes. Avoid: bundling WASM codecs or quantizers until a measured size/quality need justifies the dependency and compatibility cost.
- **Maskable.app** — focused visual safe-area previews and resize/ghost controls ([site](https://maskable.app/)). Learn: give users a visual maskable acceptance check. Avoid: treating a preview as validation; the export must still carry correct manifest purpose and pixels.
- **Capacitor Assets / Quasar IconGenie** — productive platform matrices, but their issue histories show adaptive-icon visual sizing and inset failures ([Capacitor](https://github.com/ionic-team/capacitor-assets), [Quasar issue](https://github.com/quasarframework/quasar/issues/17045)). Learn: test visible composition, not only nominal dimensions. Avoid: inheriting native-tool scope and stale platform assumptions.

## Security, Privacy, and Reliability

### Strengths verified in the repository

- The shell CSP is local-only (`default-src 'self'`, no external scripts/styles/connect targets, `object-src 'none'`, restricted forms); static tests enforce this (`index.html:1-12`, `tests/csp-shell.test.js`).
- SVG input is parsed and rejects scripts, embedded active content, and external URL forms; raster input has a 200 MB file cap and a 16,777,216-pixel downscale ceiling (`app.js:1715-1849`).
- Blob encoder failures are guarded before an output is accepted, and export manifests contain SHA-256 hashes and file metadata (`app.js:2569-2642,3558-3660`).
- Draft source-image persistence is opt-in and local, and the product does not upload source data (`app.js:718-792`, `README.md`).

### Bugs and missing guardrails

- **Generated-output injection/invalid markup — Verified.** `customBase` only needs to be nonempty, accepts `javascript:` and quote/script characters, and is interpolated without HTML/XML escaping (`app.js:2965-3017`). A browser check produced `javascript:alert(1)/favicon.ico` and an HTML snippet containing a closing quote followed by `<script>`. CSP protects IconForge’s shell, not a consuming project; [CSP guidance](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP) does not remove the need to encode generated attributes.
- **Manifest validation is fail-open — Verified.** `buildManifestSnippet()` calls `validateManifestMetadata()` but ignores its errors (`app.js:3226-3241`). A malformed shortcuts value `{` still generated files and a manifest snippet while status reported validation passed. Validate BCP47 language, URL relationships, structure, and fail the export or mark the snippet unusable; [W3C Web App Manifest](https://www.w3.org/TR/appmanifest/) defines these fields and purposes.
- **Offline cold launch is unreliable — Verified.** `sw.js:3-8` pre-caches `app.js`, `styles.css`, `icon.png`, and the manifest but not `index.html`; its navigation fallback only returns a request already in Cache Storage (`sw.js:27-47`). [MDN’s service-worker guidance](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers) requires an explicit offline shell/fallback strategy.
- **Worker failure can strand a generation — Verified.** `resizeWorker.onerror` nulls the worker and feature flag but does not reject or clear entries in `pendingWorkerJobs`; those jobs reach the 30-second timeout (`app.js:2311-2370`). A worker `messageerror` path and `toBlob()` null callback timeout are also absent; [MDN](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob) documents that `toBlob()` can return `null`.
- **Output validation trusts declarations — Verified.** `validateGeneratedOutputs()` checks the in-memory file metadata and names; it does not decode every generated PNG, ICO, manifest, or purpose asset (`app.js:3695-3944`). This misses the class of adaptive/safe-zone mistakes reported by [Capacitor](https://github.com/ionic-team/capacitor-assets/issues/108) and [Quasar](https://github.com/quasarframework/quasar/issues/17045).
- **Maskable/monochrome validation is semantically incomplete — Verified/Likely impact.** The safe-zone warning clamps padding to at least 12, making the warning unreachable, and never inspects pixels (`app.js:3918-3931`). The monochrome manifest entry reuses the largest color PNG (`app.js:3220-3231`), contrary to the manifest’s alpha/silhouette semantics ([W3C](https://www.w3.org/TR/appmanifest/), [web.dev](https://web.dev/articles/maskable-icon)).
- **PWA file handling drops additional inputs — Verified.** The launch handler consumes `handles[0]` and only warns about the rest (`app.js:1851-1875`), although the platform supports single or multiple launch files ([Chrome file handling](https://developer.chrome.com/docs/capabilities/web-apis/file-handling), [MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Associate_files_with_your_PWA)).
- **Replacement ZIP parsing is resource-unbounded — Verified.** `readZipFileNames()` walks the central directory without a maximum entry count, name length, or validated bounds before reading (`app.js:1661-1713`). Local-only input reduces remote exposure but not denial-of-service risk from a malicious or accidental archive; [OWASP](https://owasp.org/www-community/vulnerabilities/Unrestricted_File_Upload) and [CWE-409](https://cwe.mitre.org/data/definitions/409.html) support explicit limits.
- **Folder export is only per-file atomic — Verified.** `saveToFolder()` writes and closes files in sequence; a later permission/disk failure can leave earlier files in the destination (`app.js:4034-4060`). [MDN](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createWritable) describes close-time replacement for a file, not a transaction across the whole bundle.
- **Drafts can outlive user intent — Verified.** `restoreDraftState()` runs automatically (`app.js:4348`), with no visible TTL, age, size, or clear-on-export policy. This is a privacy/recovery tradeoff, not a claim of data exfiltration.

### Recovery priorities

The first recovery layer should be safe output and explicit failure state; the second should be a cached offline shell and update rollback path; the third should be draft age/clear controls and resumable folder export. Do not add cloud sync or a server-side fallback: that would conflict with the documented local/private/100%-client-side philosophy (`README.md`).

## Architecture Assessment

- **Boundary pressure.** `app.js` is a single no-build module containing UI state, persistence, input parsing, worker supervision, image rendering, platform matrices, manifest/snippet construction, export writers, and validators (the logical sections span `app.js:403-4370`). Preserve the no-build shape, but isolate pure modules or clearly delimited functions for URL/manifest policy, platform specs, artifact decoding, worker lifecycle, draft persistence, and UI strings. These are the boundaries where independent tests and future platform updates are currently hardest.
- **Platform data needs provenance.** `PWA_SPLASH_SPECS` is a hard-coded 19-entry raw-pixel list and the generated media query uses those pixels as CSS `device-width`/`device-height` (`app.js:2759-2780,3502-3504`). Apple distinguishes points from pixels ([Apple image guidance](https://developer.apple.com/design/human-interface-guidelines/images)); [web.dev](https://web.dev/learn/pwa/enhancements) and [pwa-asset-generator](https://github.com/elegantapp/pwa-asset-generator) show why scale factor/orientation belong in the data model. Add a last-verified date/source per matrix and a release check.
- **Testing is strong for names but weak for real browser behavior.** Node regression tests use a permissive canvas/blob mock, static accessibility tests check labels and handoff tabs, and the Python smoke covers Chromium happy paths, selected dimensions, ZIP names, validation, overflow, and console/page errors. They do not cover cold offline launch, Firefox/WebKit, real encoder nulls, worker crashes, malformed metadata, exact splash media, persistent reload recovery, actual safe-zone pixels, or browser keyboard accessibility (`tests/*.test.js`, `tests/browser-preset-smoke.py`).
- **Accessibility is partial.** Visible controls are labeled and handoff tabs expose relationships, but source-mode controls are visual buttons without `role=tab`, `aria-selected`, roving focus, or arrow/Home/End behavior (`index.html:42-46`, `tests/a11y-labels.test.js`). The muted token is approximately 4.12:1 against the dark background and is used at 0.65–0.7 rem (`styles.css:10,85-91`), below the 4.5:1 normal-text threshold ([WCAG](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum)).
- **Localization is a partial contract.** The string catalog covers shell/presets/status/diagnostics but many labels, errors, crop messages, output labels, and snippets remain hard-coded (`app.js:122-239`, `index.html`, `app.js:1236-1257`). Manifest `lang`/`dir` are accepted but not fully syntax-validated; [MDN](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/lang) and [W3C localizable manifests](https://www.w3.org/TR/localizable-manifests/) support completing this boundary.
- **Observability is useful but incomplete.** Diagnostics and support JSON are ahead of typical favicon generators (`app.js:3486-3660`), but there are no stable error codes, stage timings, worker failure reasons, offline/SW state, or partial-folder result. Extend the existing support payload without including source bytes.
- **Distribution and upgrade strategy need one source of truth.** `v0.4.23` and the cache name are duplicated in `app.js`, `sw.js`, README, CLAUDE, and CHANGELOG. The service-worker update notice exists, but there is no release consistency test. A generated/export schema version is also absent from `iconforge-export.json`; migration should be additive and preserve old manifests rather than silently reinterpreting them.
- **Mobile/offline are in scope; native store, multi-user, and plugin ecosystems are intentionally out of scope for now.** iOS/Android/PWA bundles and file handling are core, while the no-package/no-backend design has no extension/plugin host or account model. A future plugin boundary should be a documented pure transformation contract, not executable third-party code in the shell.

## Rejected Ideas

- **PNG quantization/WASM codecs as an immediate dependency — Rejected for now.** The repository’s zero-dependency/browser-only constraint and `Roadmap_Blocked.md` explicitly call out this decision; Squoosh demonstrates the maintenance and browser-codec tradeoff. Revisit only with a measured size budget problem and a lazy, license-reviewed path ([Squoosh](https://github.com/GoogleChromeLabs/squoosh/)).
- **AI background removal — Rejected/product-gated.** It adds a large model, new licensing/privacy questions, and a different editing promise; it is already blocked in `Roadmap_Blocked.md`.
- **Headless CLI, `npx iconforge`, or GitHub Actions — Rejected from this browser roadmap.** It requires a separate package/runtime and is already product-gated in `Roadmap_Blocked.md`; it would weaken the current no-build/local-first shape.
- **Device chrome mockups — Rejected from the next implementation tier.** [Maskable.app](https://maskable.app/) supplies the highest-value safe-area preview without maintaining a large asset matrix, while the repo records native chrome previews as blocked in `Roadmap_Blocked.md`.
- **Automatic dark variants, animated favicons, and multi-brand batch queues — Rejected/product-gated.** Each is explicitly blocked in `Roadmap_Blocked.md`; none fixes the current trust or platform-contract defects.
- **Cloud/team/multi-user workspaces — Rejected as a philosophy mismatch.** The README promises 100% client-side/private processing; adding accounts or uploads would change the product’s primary trust boundary.
- **Automatic vectorization and broad HEIF/JXL/native-store expansion — Rejected.** Vectorization is complex enough that [RealFaviconGenerator marks it wontfix](https://github.com/RealFaviconGenerator/realfavicongenerator/issues/35), while the current browser support and dependency evidence for extra codecs does not justify expanding the platform ceiling before validating existing outputs.

## Sources

### Repository and OSS competitors

https://github.com/SysAdminDoc/IconForge

https://github.com/elegantapp/pwa-asset-generator

https://github.com/itgalaxy/favicons

https://github.com/vite-pwa/assets-generator

https://github.com/vite-pwa/vite-plugin-pwa

https://github.com/guillempuche/app-asset-generator

https://github.com/ionic-team/capacitor-assets

https://github.com/RealFaviconGenerator/realfavicongenerator

https://github.com/GoogleChromeLabs/squoosh

https://github.com/hemanth/awesome-pwa

https://github.com/topics/favicon-generator

https://github.com/vite-pwa/assets-generator/issues/34

https://github.com/ionic-team/capacitor-assets/issues/108

https://github.com/quasarframework/quasar/issues/17045

https://github.com/vite-pwa/vite-plugin-pwa/issues/923

https://github.com/RealFaviconGenerator/realfavicongenerator/issues/35

### Commercial and hosted products

https://realfavicongenerator.net/

https://favicon.io/

https://maskable.app/

https://appicon.co/

https://appicongenerator.org/pricing

https://www.canva.com/create/favicon-generator/

https://rakko.tools/en/tools/favicon-generator

### Standards and platform documentation

https://www.w3.org/TR/appmanifest/

https://www.w3.org/TR/localizable-manifests/

https://www.w3.org/WAI/ARIA/apg/patterns/tabs/

https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum

https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/icons

https://web.dev/articles/maskable-icon

https://web.dev/learn/pwa/enhancements

https://developer.apple.com/design/human-interface-guidelines/images

https://developer.chrome.com/docs/capabilities/web-apis/file-handling

https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Associate_files_with_your_PWA

https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers

https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob

https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas

https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createWritable

https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/lang

https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP

### Community and issue signals

https://news.ycombinator.com/item?id=25522353

https://news.ycombinator.com/item?id=44614933

https://www.reddit.com/r/webdev/comments/1n37kyc/

https://www.reddit.com/r/webdev/comments/yhwjlv/

https://stackoverflow.com/questions/74247653/pwa-maskable-icon-overriding-larger-icons-for-splash-screen-on-android

https://stackoverflow.com/questions/52489575/json-pwa-splash-screen-isnt-working-correctly-even-when-all-requirements-are-met

https://stackoverflow.com/q/79868255/1427878

https://www.reddit.com/r/PWA/comments/1uo5p50/

https://www.reddit.com/r/PWA/comments/1luwesw/

### Security and reliability

https://owasp.org/www-community/vulnerabilities/Unrestricted_File_Upload

https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/

https://cwe.mitre.org/data/definitions/409.html

### Engineering and dependency signals

https://arxiv.org/abs/2310.00788

https://squoosh-web.pages.dev/

https://www.npmjs.com/package/favicons

https://www.npmjs.com/package/pwa-asset-generator

https://www.npmjs.com/package/@vite-pwa/assets-generator

https://github.com/elegantapp/pwa-asset-generator/pulls

https://github.com/GoogleChromeLabs/squoosh/issues

https://github.com/GoogleChromeLabs/squoosh/issues/301

## Open Questions

- Should custom deployment bases accept absolute `https://` origins, or should the safe default be a path-only base with an explicit opt-in for cross-origin URLs? This changes the URL policy and snippet security contract.
- Should monochrome be derived deterministically from source alpha/luminance, or should IconForge add a separate user-provided monochrome source? The manifest semantics are clear, but the product choice affects the encoder and UI.
- Which Apple startup matrix should be the supported release contract, and how often should it be refreshed? The current list is hard-coded and actual Safari/iOS rendering requires live-device validation.
