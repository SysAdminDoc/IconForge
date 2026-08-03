# Research — IconForge
Date: 2026-07-29 — replaces all prior research.

## Executive Summary

**[Verified]** IconForge v0.4.24 is a zero-dependency, client-only PWA that turns one local image, text mark, or emoji into validated Web, PWA, extension, Android, iOS, Windows, social, and custom icon bundles. Its strongest shape is the unusually deep export contract: local processing, cross-engine fallbacks, versioned drafts and export manifests, deployment-aware snippets, artifact validation, diagnostics, and transactional folder writes are already shipped and tested. The highest-value direction is therefore not more output breadth; it is making v0.4.24 safer under large workloads, correct as an installed PWA, easier to navigate after a 57-file generation, reproducible from its own export manifest, and aligned with Android launcher guidance accessed on 2026-07-29 while preserving the local-only/no-build philosophy.

Top opportunities, in priority order:

1. **[Verified] Repair IconForge's own install identity.** `manifest.webmanifest` declares `icon.png` as 512×512 although the file is 1024×1024, supplies no 192×192 or maskable icon, and uses `#09090b` while `index.html`/`styles.css` use `#07090f`.
2. **[Verified] Add aggregate resource budgets and cancellable ZIP creation.** `app.js::addCustomSize` allows any number of sizes up to 4096×4096; `generateIcons` retains every Blob; `downloadAll` copies each Blob into an ArrayBuffer; and `buildZip` allocates the complete uncompressed archive again.
3. **[Verified] Finish interaction semantics.** Shape and emoji choices expose visual state without `aria-pressed`, repeated output actions are named only “Download”/“Copy Base64,” and the workflow rail leaves `aria-current="step"` on Source after generation (`index.html`, `app.js::addOutputItem`).
4. **[Verified] Replace the flat result wall with grouped, progressive results.** The PWA smoke contract produces 57 image files plus support files; the 390×844 live audit produced a 10,120 CSS-pixel document with no horizontal overflow but excessive vertical scanning.
5. **[Verified] Complete the Android launcher contract.** The Android preset emits foreground/background/legacy PNGs and one v26 adaptive XML, but no round launcher resources or API 33 monochrome layer (`app.js::buildAndroidSnippet`, `expectedPresetFileGroups`).
6. **[Verified] Reforge from `iconforge-export.json`.** The file already contains schema version, migration metadata, preset, sizes, formats, processing, deployment, and manifest options, but `inspectExportManifest` is validation-only and the UI cannot import it.
7. **[Verified] Add real image fixtures and production-PWA upgrade tests.** Tests run on 2026-07-29 are strong on synthetic contracts and browser workflows but do not maintain a malformed/EXIF/transparency fixture corpus, pixel-tolerance goldens, production icon-dimension checks, or a service-worker version transition.
8. **[Verified] Finish the localization boundary.** `UI_STRINGS` covers the shell and many statuses, but crop, replacement-template, progress, and action strings remain embedded in `app.js`; no locale selection, pseudo-locale, or RTL workflow test exists.
9. **[Verified] Add optional per-role source artwork.** Multiple competitors support distinct icon, splash background, Android foreground, and background sources; IconForge currently applies one source and one transform to every platform.
10. **[Verified] Extract testable no-build core modules.** `app.js` is 6,242 lines and `tests/export-regression.test.js` executes the entire script in a VM to reach pure ZIP, manifest, draft, platform, and validation logic.

## Product Map

- **[Verified] Core workflows:** load/drop/paste/file-handle a local source; create text or emoji artwork; crop/shape/pad/process; choose a platform preset or custom size/format set; generate, validate, copy snippets, download ZIP, or transactionally save a folder.
- **[Verified] User personas:** web developers needing favicons/PWA/extension assets; mobile developers needing Android/iOS resource trees; designers and indie developers preparing one brand for several platforms; privacy-sensitive users who cannot upload source artwork.
- **[Verified] Platforms and distribution:** static HTML/CSS/JavaScript PWA on modern Chromium, Firefox, and WebKit engines; installable/offline over HTTPS; no package manager, build step, runtime service, account, telemetry, or third-party runtime dependency.
- **[Verified] Key integrations and data flows:** browser image decoders and Canvas/OffscreenCanvas; Web Workers with main-thread fallback; File System Access with ZIP fallback; Cache/Service Worker lifecycle; localStorage drafts; generated W3C manifest, HTML/framework snippets, Android XML, iOS `Contents.json`, Windows XML, and schema-v2 export/diagnostic JSON.

## Competitive Landscape

- **[Verified] RealFaviconGenerator:** does platform-specific editing, integration instructions, and live-site checking well. Learn from its purpose-led preview/verification and explain each output; avoid adding a network-dependent checker that weakens IconForge's offline/local boundary.
- **[Verified] `itgalaxy/favicons`:** exposes deep manifest metadata, separate maskable/shortcut sources, multiple input images, and cache-busting. Learn from portable configuration and source roles; avoid its Node/runtime dependency and unconstrained option surface.
- **[Verified] PWA Asset Generator / Vite PWA Assets Generator:** automate icon/splash generation, declaration injection, multiple sources, and specification tracking. Learn from explicit source provenance and separate icon/splash inputs; avoid browser automation and live specification scraping in the shipped app.
- **[Verified] Capacitor Assets:** balances an easy one-logo mode with full-control foreground/background/splash sources. Adopt that progressive-disclosure model; avoid Capacitor-specific project coupling.
- **[Verified] Appicons / Quasar Icon Genie:** provide grouped previews, dry-run/verify flows, reusable profiles, setting history, modern Android themed assets, and broad platform handoffs. Learn from re-runnable profiles and preflight; avoid turning the browser tool into a CLI or matching their watchOS/tvOS/visionOS breadth.
- **[Verified] Favicon.io:** makes image/text/emoji paths and the final package easy to understand, with searchable categorized emoji. Learn from its discovery and small-size guidance; avoid remote icon/font catalogs with attribution and licensing state.
- **[Verified] Squoosh:** proves that private browser-side image work can expose capable codecs and worker-backed processing. Learn from capability detection and performance isolation; avoid importing a large codec/dependency surface without the explicit dependency decision already required by `Roadmap_Blocked.md`.
- **[Verified] IconFast / Canva / Drip:** monetize project saving, brand kits, team review, store screenshots, localization, device frames, and direct publishing. This validates reproducibility and localization as valuable, but cloud collaboration, store publishing, and screenshot design would dilute IconForge's focused private asset-forging role.

## Security, Privacy, and Reliability

- **[Verified] Aggregate-memory exhaustion is the principal unguarded failure mode.** A 4096×4096 RGBA surface is about 64 MiB before encoded Blobs; custom-size count is unbounded, generated Blobs remain resident, and ZIP export duplicates data through `Blob.arrayBuffer()` and a final archive allocation (`app.js::addCustomSize`, `generateIcons`, `downloadAll`, `buildZip`). ZIP fields are also 32-bit with no ZIP64 rejection.
- **[Verified] Existing input and write guardrails are substantial.** Source files are capped at 200 MiB with a warning above 50 MiB; decoded dimensions are reduced to 16,777,216 pixels; drafts cap at 4 MiB and expire; generated artifacts are decoded and checked; imported replacement ZIPs have path/count/size limits; folder writes stage, verify, roll back, and report partial recovery (`app.js`, `tests/export-regression.test.js`, `tests/browser-preset-smoke.py`).
- **[Verified] Production install metadata is internally inconsistent.** `manifest.webmanifest` misdeclares the only icon's dimensions and omits the standard 192×192/maskable set. This can produce incorrect install presentation even though generated customer manifests are strongly validated.
- **[Verified] As of 2026-07-29, no application dependency advisory applies because the shipped app has no third-party runtime packages.** Browser-native image decoding remains part of the trusted runtime. OWASP upload guidance and WebP/libvips advisories accessed on 2026-07-29 reinforce keeping strict byte/pixel budgets and a malicious fixture corpus rather than casually adding native/WASM codecs.
- **[Verified] Recovery is strongest for folder export and drafts, weakest for archive creation.** ZIP creation has no progress, cancellation, peak-size gate, or resumable path; a failure leaves the generated files available but gives only a terminal error. Add preflight, cancellation, and a folder-export recommendation where supported.

## Architecture Assessment

- **[Verified] The runtime boundary is too broad.** ZIP/CRC, source inspection, draft migration, rendering, platform matrices, manifest validation, artifact inspection, diagnostics, and DOM orchestration share `app.js`. Extracting native ES modules without adding a build system would reduce regression blast radius and let tests import pure functions directly.
- **[Verified] The existing schema work is underused.** `buildExportManifest` records the exact reproducible options and `inspectExportManifest` already handles v1 migration/future-version rejection. An import/apply boundary can reuse those contracts and must never claim to restore absent source bytes.
- **[Verified] UI state is split between CSS classes and accessibility metadata.** The APG source tabs are well implemented, but shape/emoji toggles, workflow stage, and repeated output actions do not expose equivalent state or context (`index.html`, `app.js`).
- **[Verified] Test depth is high but fixture breadth is low.** Syntax, release consistency, CSP, labels, synthetic export contracts, draft migrations, cancellation/fallbacks, and representative Chromium/Firefox/WebKit workflows pass on 2026-07-29. There are no screenshot goldens, pixel-tolerance image baselines, malformed decoder fixtures, or production-manifest icon dimension checks (`tests/`).
- **[Verified] Specification provenance is already a strength.** PWA splash, Android, and iOS matrices record source URLs and `2026-07-25` verification dates. Preserve the explicit review model; an automated scraper would add brittle network/build coupling.
- **[Verified] Documentation and diagnostics are not primary gaps.** README coverage, schema descriptions, capability reporting, operation timings, stable diagnostic error codes, and redaction are unusually complete. New work should update those existing surfaces rather than create new documentation or telemetry systems.

## Rejected Ideas

- **AI icon/background generation** — rejected from the active roadmap because AppIconGenerator, Drip, and IconGAN require remote inference or a large/licensed local model; `Roadmap_Blocked.md` already requires that decision.
- **PNG quantization, HEIC/JPEG XL, or bundled WASM codecs** — rejected pending the existing dependency decision; Squoosh/pica show the value, while the Sharp/libvips advisory published on 2026-07-17 shows the continuing patch burden.
- **Dark/tinted/clear iOS variants and device-chrome previews** — rejected from active work because Apple Icon Composer guidance accessed on 2026-07-29 confirms their platform relevance, but source/brand transformation rules and visual assets remain product-gated in `Roadmap_Blocked.md`.
- **Animated favicons and multi-brand batch queues** — rejected because format/browser policy and multi-source UX are already explicitly product-gated.
- **Headless CLI, native desktop/mobile wrappers, and direct Xcode/Gradle sync** — rejected because Appicons, Favsmith, TAU, and IconSync solve a different distribution problem; CLI work is already blocked pending a package design.
- **Store screenshot builder, ASO localization, and direct store publishing** — rejected despite IconFast/Drip commercial signal because these require design/editor scope, credentials, and external services rather than icon packaging.
- **Cloud accounts, multi-user/team collaboration, brand kits, or telemetry** — rejected because Canva/Squoosh demonstrate those patterns, but they contradict IconForge's no-account/no-tracking/local-only promise.
- **Remote website/favicon checker or URL import** — rejected because RealFaviconGenerator does this well, while CORS, network availability, and remote-content privacy would compromise offline determinism.
- **Executable plugin ecosystem** — rejected because no stable public core API exists and arbitrary extension code would expand CSP, security, versioning, and support obligations; versioned declarative project imports cover the verified need with lower risk.
- **Automatic platform-spec scraping** — rejected because PWA Asset Generator's issue history shows scraper breakage; keep source URLs, absolute verification dates, and review-enforced tests.

## Sources

### Open source and adjacent projects

https://github.com/itgalaxy/favicons
https://github.com/elegantapp/pwa-asset-generator
https://github.com/vite-pwa/assets-generator
https://github.com/RealFaviconGenerator/realfavicongenerator
https://github.com/zhangyu1818/appicon-forge
https://github.com/guillempuche/appicons
https://github.com/ionic-team/capacitor-assets
https://github.com/romannurik/AndroidAssetStudio
https://github.com/airyland/logo.surf
https://github.com/faviator/faviator
https://github.com/ACP-CODE/astro-favicons
https://github.com/jakejarvis/favsmith
https://github.com/GoogleChromeLabs/squoosh
https://quasar.dev/icongenie/command-list/
https://github.com/hemanth/awesome-pwa
https://github.com/goabstract/Awesome-Design-Tools

### Commercial and hosted products

https://realfavicongenerator.net/
https://realfavicongenerator.net/favicon-checker
https://favicon.io/
https://iconfast.io/
https://www.canva.com/create/favicon-generator/
https://getdrip.dev/
https://appicongenerator.org/pricing
https://www.tauicongenerator.com/

### Standards and platform guidance

https://www.w3.org/TR/appmanifest/
https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/icons
https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/screenshots
https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/%2A_localized
https://developer.chrome.com/blog/richer-pwa-installation
https://developer.chrome.com/blog/improvements-to-web-app-updates
https://developer.android.com/studio/write/create-app-icons
https://developer.android.com/distribute/aep/aep-req-theme-app-icons
https://developer.apple.com/design/human-interface-guidelines/app-icons
https://developer.apple.com/documentation/xcode/configuring-your-app-icon
https://developer.apple.com/documentation/Xcode/creating-your-app-icon-using-icon-composer
https://developer.apple.com/library/archive/documentation/Xcode/Reference/xcode_ref-Asset_Catalog_Format/AppIconType.html
https://www.w3.org/WAI/ARIA/apg/patterns/button/
https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/canvas
https://developer.mozilla.org/en-US/docs/Web/API/File_System_API
https://web.dev/learn/pwa/update

### Engineering, research, and security

https://web.dev/blog/squoosh-v2
https://developer.chrome.com/docs/chromium/renderingng-architecture
https://www.npmjs.com/package/pica
https://arxiv.org/abs/2305.17609
https://arxiv.org/abs/2208.00439
https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
https://github.com/advisories/GHSA-f88m-g3jw-g9cj
https://nvd.nist.gov/vuln/detail/CVE-2026-46601

### Community signal

https://www.reddit.com/r/PWA/comments/1p92mor/why_are_pwa_icons_still_a_mess_in_2025_and_my/
https://www.reddit.com/r/webdev/comments/1o2w439/infuriatingly_dumb_favicon_question/
https://www.reddit.com/r/webdev/comments/1n37kyc/whats_the_best_way_to_create_a_favicon/
https://www.reddit.com/r/opensource/comments/1qq2e1s/built_a_fast_private_image_compression_website/
https://stackoverflow.com/questions/67300785/pwa-launch-icon-update
https://news.ycombinator.com/item?id=44614933
https://lobste.rs/s/hnqkhk/remove_these_tags_from_head

## Open Questions

None. Decisions requiring credentials, brand rules, dependency acceptance, or a broader product boundary remain isolated in `Roadmap_Blocked.md` and do not block the priorities below.
