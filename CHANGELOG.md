# Changelog

All notable changes to IconForge will be documented in this file.

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
