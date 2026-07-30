# Changelog

All notable changes to IconForge will be documented in this file.

## [Unreleased]

### Changed
- The app shell is now a responsive forge workstation with a compact command header, Source → Configure → Export workflow rail, source studio, layered configuration cards, and a distinct export console.
- Presets, metadata, output sizing, processing controls, generated assets, diagnostics, and snippets now use a cohesive navy, ember, and indigo visual system with stronger hierarchy and touch targets.
- Generation now reports operation count and conservative peak working memory before starting; unsafe jobs are rejected without discarding prior output.
- ZIP export now enforces memory and ZIP32 limits before allocation, computes CRCs incrementally, reports progress, yields between chunks, and can be cancelled without losing generated files.
- Generated assets are grouped into collapsible platform families with file/byte summaries, validation badges, and filename/format/status filters.

### Added
- Android exports now include density-correct round launcher PNGs, black-alpha monochrome themed-icon layers, v26 regular/round adaptive XML, API 33 monochrome XML, and an `AndroidManifest.xml` handoff with `android:icon` and `android:roundIcon`.
- Android validation now proves all launcher XML references resolve across mdpi–xxxhdpi and checks themed monochrome pixel semantics.
- Reforge Previous Export now previews and restores reproducible settings from `iconforge-export.json`, migrates v1 in memory, fails closed on malformed or future schemas, and requests source-artwork re-selection.

### Fixed
- Hidden progress and output states now remain hidden until their owning workflow explicitly reveals them.
- Production install metadata now ships exact 192px and 512px icons, a dedicated maskable icon, aligned shell colors, and offline-cached identity assets.
- Duplicate platform filenames now replace their previous preview card as well as their export-state record, keeping rendered counts aligned with exported files.

### Accessibility
- Text shapes and emoji choices now maintain one `aria-pressed` selection, the workflow rail advances a single `aria-current` step, and every generated download/copy action includes its filename.

## [v0.4.24] - 2026-07-25

### Fixed
- Custom deployment bases now reject unsafe schemes, credentials, queries, fragments, controls, quotes, markup, malformed escapes, and protocol-relative URLs.
- Generated HTML and XML URL attributes are encoded before they are copied or exported.
- The service worker now pre-caches both root and `index.html` shell navigations, falls back to the cached shell offline, and returns deterministic failures for uncached static assets.
- Apple startup tags now use CSS point dimensions, device scale factors, and explicit orientation instead of raster pixels as CSS device dimensions.
- Maskable PWA icons now reserve an inscribed-square safe area within the 40% manifest radius and use a deterministic opaque background outside it.
- Manifest generation now fails closed on malformed JSON, invalid BCP 47 language tags, unsafe or out-of-scope URLs, invalid shortcut objects, and malformed screenshot metadata.
- Resize-worker crashes, unreadable messages, transfer failures, and timeouts now terminate the worker and reject every pending job immediately; canvas encoders also have a bounded callback timeout.
- Clear Draft now cancels pending autosaves so a queued settings write cannot recreate the deleted draft.
- Replacement ZIP scanning now enforces byte, entry, central-directory, filename, and total-name limits with strict bounds and UTF-8 validation.

### Added
- Export validation now decodes every image artifact to verify signatures, MIME types, dimensions, ICO directories, support-file syntax, maskable pixels, and monochrome RGB semantics.
- Optional monochrome export now creates a dedicated black alpha silhouette rather than reusing a full-color PNG.
- The Apple startup matrix records its upstream source and `2026-07-25` verification date, including the iPhone Air 1260x2736 target.
- Large generations now show stage, filename, and completed-work progress with cancellation that clears partial output and permits immediate retry.
- Folder export now preflights destination conflicts, creates a collision-free bundle directory, and rolls back the whole directory on failure or cancellation; failed rollback reports every partial file.
- Upload, Text, and Emoji source modes now implement APG tabs with roving focus and Arrow/Home/End activation; errors receive assertive programmatic focus, focus rings remain visible, and muted text meets 4.5:1 on supported dark surfaces.
- Runtime and service-worker versions now share `version.js`; the release gate rejects runtime, cache, README, changelog, or platform-source metadata drift.
- Draft recovery now uses a migratable v2 schema, reports saved age/bytes/privacy/TTL, expires after 30 days, drops corrupt or unknown records, enforces a 4 MB cap, and supports disable or clear-after-export policies.
- Manifest metadata now round-trips W3C `name_localized`, `short_name_localized`, and `description_localized` language maps with canonical BCP 47 tags and validated localized text direction.
- The default English UI catalog now covers every visible shell literal plus generation status and validation outcomes; missing catalog keys fail regression tests.

### Tests
- Browser smoke now verifies a freshly installed service worker can render both `/` and `/index.html` while the browser is offline.
- Browser smoke now enables monochrome PWA output and requires full artifact-byte, maskable-pixel, and platform validation to pass.
- Browser smoke now cancels a live PWA generation, verifies partial output is removed, and regenerates successfully.
- Browser smoke now exercises source-tab keyboard navigation, rendered focus styling, and assertive error focus.
- Release consistency coverage verifies the canonical version and absolute source/verification metadata for PWA splash, Android icon, and iOS AppIcon matrices.
- Browser resilience coverage verifies draft reload, clear-through-unload, expiration cleanup, and persistent disable behavior.
- Static catalog coverage rejects uncataloged shell text and unresolved `data-i18n` keys.
- Chromium, Firefox, and WebKit now run representative artifact, Unicode/unsafe source, large-input, encoder, worker-fallback, draft-resilience, and offline-capability checks with explicit unsupported states.
- Export manifests now publish additive schema v2 compatibility metadata separately from the app version, migrate legacy v1 records in memory, and reject unsupported future schemas with stable errors.
- Diagnostics schema v2 adds stable error codes, generation/folder stage timings, service-worker state, and completed, rolled-back, or partial folder-write results without source bytes.

## [v0.4.23] - 2026-06-30

### Added
- Default English UI string catalog for shell text, status messages, diagnostics, validation titles, and snippet fallbacks.
- Startup catalog application for tagged shell text and tests for catalog hooks.

## [v0.4.22] - 2026-06-30

### Added
- Installed PWA manifest now declares image file handlers for PNG, JPG, WebP, SVG, GIF, BMP, TIFF, and ICO files.
- Runtime launch handling imports files received through the File Handling API using the existing image-loading path.
- Diagnostics now report PWA file-handling support.

## [v0.4.21] - 2026-06-30

### Added
- Draft recovery saves recent settings locally and can optionally store the source image for reload recovery.
- Clear Draft action removes the saved local draft while leaving the current workspace open.
- Regression coverage verifies draft metadata, crop, processing settings, source-image opt-in behavior, and clear/read lifecycle.

## [v0.4.20] - 2026-06-30

### Added
- Diagnostics panel can copy or download a support JSON report with app version, browser support, preset, selected formats, validation checks, worker fallback state, encoder errors, and generated-file metadata.
- Regression coverage verifies diagnostics JSON does not include Blob payloads or source image data URLs.

## [v0.4.19] - 2026-06-30

### Fixed
- Handoff snippet tabs now expose stable tab/panel relationships, roving tabindex, and Arrow/Home/End navigation.
- Accessibility coverage now checks snippet tab IDs, `aria-controls`, selected state, and panel labelling.

## [v0.4.18] - 2026-06-30

### Added
- Lossy JPG/WebP/AVIF quality control with export-manifest and diagnostics coverage.
- Optional total size-budget warnings in validation, diagnostics, and generation status.

## [v0.4.17] - 2026-06-30

### Added
- Manifest metadata now supports optional `id` export.
- Manifest exports can add a monochrome icon purpose entry from the largest non-maskable square PNG.
- Regression coverage for omitted and populated manifest `id` and monochrome purpose fields.

## [v0.4.16] - 2026-06-30

### Added
- PWA splash generation now covers 19 current unique Apple portrait dimensions, including iPhone 16/iPhone 15 families, iPad Air 13/11, iPad 11, and iPad mini 8.3.
- Generated startup-image snippets now include every generated portrait and landscape splash asset.
- PWA validation now reports the full generated splash dimension matrix.

## [v0.4.15] - 2026-06-30

### Added
- Android preset now exports mdpi, hdpi, xhdpi, xxhdpi, and xxxhdpi foreground/background adaptive icon layers.
- Android preset now includes density-aware legacy `ic_launcher.png` assets alongside the adaptive XML handoff.

## [v0.4.14] - 2026-06-30

### Added
- Browser-driven preset smoke covering Modern Web, PWA, Android, iOS, Windows, and Social Preview rendered exports.
- Artifact verification decodes PNG dimensions, ICO entries, ZIP payload names, validation state, diagnostics, and desktop/mobile overflow.

### Fixed
- Windows tile exports no longer warn about missing web-manifest icons because that preset does not generate a web manifest.

## [v0.4.13] - 2026-06-30

### Fixed
- Canvas and worker encoder paths now reject missing or empty blobs before registering generated files.
- SVG uploads now preflight malformed XML, active SVG content, and external references with clear status and diagnostics.
- Added regression coverage proving invalid SVG input and bad blobs cannot reach export state.

## [v0.4.12] - 2026-06-30

### Added
- Deployment URL controls for root-relative, relative, or custom-base asset URLs.
- Optional SHA-256 cache-busting query strings for generated asset references in snippets and manifests.
- Export manifest coverage for the selected deployment URL policy.

## [v0.4.11] - 2026-06-30

### Fixed
- SVG favicon exports now embed their light/dark `prefers-color-scheme` CSS and selected colors directly instead of linking the app stylesheet.
- Added regression coverage proving SVG favicon exports are self-contained and do not reference `styles.css`.

## [v0.4.10] - 2026-06-30

### Added
- Optional Social Preview preset that exports Open Graph, Twitter, and LinkedIn PNG preview assets.
- Copyable social preview meta tags and export support file coverage for generated social assets.
- Regression coverage for social preview filenames, snippets, support files, and validation.

## [v0.4.9] - 2026-06-30

### Added
- `iconforge-export.json` for ZIP and folder exports with app version, preset, source mode, generation options, file inventory, dimensions, MIME types, byte sizes, and SHA-256 hashes.
- Regression coverage for export manifest payloads and checksums.

## [v0.4.8] - 2026-06-30

### Added
- Tabbed framework handoff snippets for plain HTML, Vite, Next.js app router, Astro, Chrome MV3, Firefox MV3, Android, and iOS.
- Regression coverage for framework handoff snippet paths and shell tab wiring.

## [v0.4.7] - 2026-06-30

### Added
- Generation diagnostics panel with browser feature support, selected preset/formats, skipped or hidden formats, worker fallback state, generated file count, total bytes, and validation status.
- Regression coverage for diagnostics model output and shell panel wiring.

### Changed
- Worker resize errors now fall back to the canvas path and report the fallback reason instead of aborting generation.

## [v0.4.6] - 2026-06-28

### Security
- Split the inline application script and stylesheet into `app.js` and `styles.css`.
- Added a CSP meta policy that restricts scripts and styles to local files while allowing the blob/data capabilities required for previews, downloads, and the resize worker.
- Removed external font and raw-image references from the runtime shell.
- Added a static regression test for the externalized CSP shell.

## [v0.4.5] - 2026-06-28

### Added
- Compact manifest metadata panel for app name, short name, description, start URL, scope, display mode, categories, colors, shortcuts, screenshots, language, and direction.
- Manifest metadata validation for required fields and JSON array shortcut/screenshot inputs.
- Regression coverage for default manifest metadata, edited metadata, optional language/direction omission, and invalid metadata JSON.

## [v0.4.4] - 2026-06-28

### Accessibility
- Added programmatic labels for text-source, font, custom width, and custom height controls.
- Added a local accessibility smoke test for visible form-control labels.

## [v0.4.3] - 2026-06-28

### Added
- Non-blocking update notice for installed PWA users when a new service worker is waiting or has activated in the background.
- Reload action that tells the waiting service worker to activate before refreshing the tab.

### Changed
- Service worker cache version now tracks the app release and no longer force-activates updates without a visible recovery path.

## [v0.4.2] - 2026-06-28

### Added
- Export validation panel that reports pass/warn/fail status after generation.
- Platform-specific checks for missing files, expected dimensions, manifest icon metadata, deployable support files, and PWA maskable safe-zone coverage.
- Regression coverage for validator pass and failure cases.

## [v0.4.1] - 2026-06-28

### Added
- Dependency-free export regression tests for ZIP central directory output, ICO headers, platform filenames, generated manifest/snippet support files, and replacement-template matching.

### Changed
- Removed the duplicate snippet-generation implementation so there is one active snippet builder for HTML, manifest, extension, Android, iOS, and Windows snippets.
- README now documents the local syntax and export regression verification commands.

## [v0.4.0] - 2026-06-27

### Added
- Platform bundle presets for Modern Web, PWA, Extension, Android adaptive icons, iOS AppIcon.appiconset, Windows tiles, and All Sizes.
- PWA maskable icons, iOS splash images, web manifest export, and HTML startup/link snippets.
- Android adaptive icon foreground/background PNG export plus `ic_launcher.xml` snippet.
- Full iOS AppIcon.appiconset image matrix with generated Contents.json.
- Windows tile images with generated browserconfig.xml.
- Processing controls for safe padding, resampling, background fill/gradient, drop shadow, and tint/desaturate/glass effects.
- Maskable safe-zone preview with circle, squircle, and rounded-square overlays.
- Replacement template matching from folder selections or ZIP central-directory filenames.
- Deployable ZIP support files: README.txt, HTML snippet, manifest JSON, Android XML, iOS Contents.json, and Windows browserconfig.xml.

### Changed
- Generated preset files now use deployment-ready filenames and folder structures where applicable.
- ICO generation uses the same processing renderer as PNG/JPG/WebP/AVIF output.
- README updated for v0.4.0 platform bundle behavior.

## [v0.3.0] - 2026-06-15

### Added
- HTML `<link>` snippet generation with copy button.
- Manifest JSON snippet generation.
- Input file size guard: reject >200MB, warn >50MB before processing.

### Changed
- Output previews now use Blob URLs instead of base64 dataURLs.
- Base64 copy button lazy-generates dataURL on click instead of pre-computing.
- Removed deprecated `document.execCommand('copy')`.
- Service Worker now uses network-first for HTML and cache-first for static assets.

### Fixed
- Fix Safari WebP silent data corruption by feature-detecting WebP output.
- Fix Worker ImageBitmap transfer and worker timeout/error rejection.
- Fix "All Sizes" preset missing 180x180.
- Fix manifest.webmanifest color mismatch.
- Free temporary canvases in crop detection and preview generation.

## [v0.2.0] - 2026-06-15

### Security
- Fix XSS vulnerability: filenames rendered via `textContent` instead of `innerHTML`.
- Add SRI integrity hash and `crossorigin` to JSZip CDN script tag.
- Escape HTML in output item filenames.

### Added
- Emoji-to-favicon mode.
- Text-to-favicon mode.
- AVIF output format.
- OffscreenCanvas Web Worker for non-blocking batch resize.
- One-click bundle presets.
- SVG favicon output with embedded dark-mode CSS.
- Clipboard image paste support.
- Service Worker + PWA manifest for offline support and installability.
- File System Access API "Save to Folder" button.
- Per-icon file size display with total size summary.

### Changed
- Replace JSZip CDN dependency with inline STORE-mode ZIP builder.
- Revoke blob URLs on reset and re-generation.

### Accessibility
- Add WCAG 2.2 AA baseline.
- Add numeric crop inputs as pointer alternative.
- Add visible focus ring on interactive elements.

### Fixed
- Fix `getCroppedImage()` assigning to readonly image properties.
- Add canvas dimension validation and browser-limit downscaling.

## [v0.1.0] - 2026-06-14

- Initial static icon generator seed.
