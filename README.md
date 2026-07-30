# Icon Forge

![Version](https://img.shields.io/badge/version-v0.4.24-58A6FF) ![License](https://img.shields.io/badge/license-MIT-green) ![Platform](https://img.shields.io/badge/platform-Web-58A6FF) ![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)

Generate favicons, PWA icons, mobile app icon sets, Windows tiles, and browser extension assets entirely in your browser. No uploads, no server, no tracking. Works offline.

**[Launch Icon Forge](https://sysadmindoc.github.io/IconForge/)**

## Features

- **Multiple input modes** - upload an image, paste from clipboard, create from text/letter, or pick an emoji
- **All icon formats** - PNG, ICO (multi-resolution), SVG (with dark mode CSS), JPG, WebP, AVIF
- **Platform bundles** - one-click exports for Modern Web, PWA, Chrome Extension, Android adaptive icons, iOS AppIcon.appiconset, Windows tiles, or All Sizes
- **Advanced role artwork** - optionally supply separate local-only splash, Android foreground, and Android background sources with independent contain/center-crop and padding controls; omitted roles use explicit defaults
- **Android launcher handoff** - emits regular and round density buckets, v26 adaptive XML, API 33 monochrome themed-icon XML, and manifest icon references
- **Social previews** - optional Open Graph, Twitter, and LinkedIn preview PNGs with copyable meta tags
- **Auto-crop** - detect content bounds and trim whitespace with adjustable tolerance
- **Manual crop** - draw a crop rectangle or enter precise dimensions
- **Maskable preview and validation** - safe-zone overlays plus decoded-pixel checks against the 40% manifest safe zone
- **Small-size legibility review** - decoded 16/32/48/192/512 PNG previews on light, dark, and alpha surfaces with adaptive-mask views and non-blocking clipping, empty-alpha, tonal-detail, and contrast warnings
- **Processing controls** - safe padding, lossy quality, size-budget warnings, background fill or gradient, drop shadow, tint/desaturate/glass effects, and pixel-hinted small icons
- **Code snippets** - generates HTML `<link>` tags, `manifest.webmanifest` JSON, extension manifest icon blocks, Android XML, iOS Contents.json, and Windows browserconfig.xml
- **Framework handoffs** - tabbed snippets for plain HTML, Vite, Next.js app router, Astro, Chrome/Firefox MV3, Android, and iOS
- **Deployment URL controls** - generate root-relative, relative, or custom-base asset URLs with optional SHA-256 cache-busting queries
- **Input and encoder guardrails** - sniffs bounded image headers before decode, rejects mismatched/truncated/unsafe-dimension inputs and malformed/external SVG, bounds replacement ZIP bytes/entries/names/offsets, and prevents empty canvas blobs from entering exports
- **Manifest metadata** - validate app identity, scoped URLs, BCP 47 language, W3C `*_localized` language maps, shortcuts, screenshots, and purpose-specific icons before any deployable manifest is emitted
- **CSP-hardened shell** - local CSS and JavaScript files run under a strict self-only policy with blob/data allowances for previews, downloads, and workers
- **Deployable ZIPs** - exports generated images plus README.txt and the platform support files needed by the selected bundle
- **Export manifest** - ZIP and folder exports include `iconforge-export.json` schema v2 with app-version compatibility metadata, file inventory, dimensions, MIME types, byte sizes, and SHA-256 hashes
- **Reforge previous exports** - preview and restore sizes, formats, processing, replacement targets, deployment URLs, and manifest metadata from `iconforge-export.json`, then re-select source artwork
- **Export validation** - decodes generated PNG/JPG/WebP/AVIF/ICO/SVG bytes, verifies MIME types and dimensions, parses support files, and checks manifest-purpose semantics before deployment
- **Observable, cancellable generation** - shows the current stage and filename for large bundles, cancels promptly, clears partial output, and supports immediate retry
- **Resource-safe exports** - preflights operation count and peak memory, enforces ZIP32 limits, builds ZIPs incrementally with progress/cancellation, and preserves generated files when export is stopped
- **Conflict-safe folder exports** - writes each bundle into a new collision-free folder and removes the entire folder after a failed or cancelled write
- **Keyboard-accessible source modes** - Upload, Text, and Emoji use APG tabs with Arrow/Home/End navigation, high-visibility focus rings, assertive error focus, and WCAG-compliant muted text
- **Stateful assistive semantics** - shape and emoji selection expose pressed state, the workflow rail announces its current step, and repeated output actions include their filename
- **Generation diagnostics** - reports browser and service-worker support, selected preset/formats, stable errors, per-stage timings, worker fallback state, folder-write recovery, file count, byte total, and validation status
- **Draft recovery controls** - saves v3 settings with visible age/size and a 30-day TTL, optionally restores main and per-role source bytes under one 4 MB limit, migrates v1/v2 drafts, supports disable/clear, and can clear automatically after ZIP or folder export
- **Installed file handling** - installed Chrome/Edge PWAs can open supported image files from the operating system
- **UI string catalog** - shell, status, diagnostic, validation, and snippet text now route through default English catalog keys for future localization
- **Localization test modes** - persistent BCP 47 locale selection includes deterministic pseudo-expanded and pseudo-RTL catalogs that exercise shell/runtime copy, bidirectional layout, focus order, and generated-manifest `lang`/`dir`
- **Drop-replace template matching** - load an existing folder or ZIP filename map and export only matching generated assets
- **File size display** - see per-icon and total file sizes after generation
- **Grouped result explorer** - scan artifact families by count, bytes, and validation state; collapse large sets or filter by filename, format, and status
- **SVG dark mode** - generates SVG favicons with embedded `prefers-color-scheme` CSS
- **Offline PWA** - install as a Progressive Web App, works without internet, and keeps a new shell waiting behind a reload notice that saves the current draft before activation
- **100% client-side** - all processing happens in your browser via Canvas and Web Workers

## Getting Started

1. Go to **[sysadmindoc.github.io/IconForge](https://sysadmindoc.github.io/IconForge/)** or open `index.html` locally.
2. Upload an image, use text mode, or use emoji mode.
3. Select sizes and formats, or pick a platform preset.
4. Click **Generate Icons**.
5. Download individually, download a deployable ZIP, save to a collision-safe new folder, or copy the generated snippets.

No build step, no package manager, no dependencies.

Core ZIP/CRC, schema migration, platform matrix, generated-manifest, and artifact-validation contracts live in native ES modules under `core/`. The DOM-facing `app.js` imports those `.js` modules directly, so browser runtime and regression tests exercise the same dependency-free contracts across simple static servers.

### Localization contract

The **Localized Fields JSON** manifest input accepts `name_localized`, `short_name_localized`, and `description_localized` language maps. Each BCP 47 key maps to a non-empty string or a `{ "value", "lang", "dir" }` object; language tags are canonicalized and `dir` is limited to `auto`, `ltr`, or `rtl`. Unknown localized members and malformed values fail closed. The interface locale persists locally, updates document `lang`/`dir`, and falls back to English for unsupported tags. `en-XA` pseudo-expanded and `ar-XB` pseudo-RTL are test catalogs rather than production translations; they cover cataloged shell/runtime strings and synchronize default manifest language/direction so clipping, interpolation, focus order, and generated metadata remain regression-testable.

### Export compatibility

`iconforge-export.json` uses integer `schemaVersion: 2` independently of `appVersion`. Version 2 is additive: it retains the legacy `version` alias and adds explicit reader compatibility/migration metadata. **Reforge Previous Export** previews and applies the recorded preset, sizes, formats, processing, replacement targets, deployment URLs, and manifest metadata; source artwork is intentionally absent and must be re-selected. The reader migrates legacy manifests without `schemaVersion` as version 1 in memory, rejects malformed settings, and reports a stable `EXPORT_SCHEMA_UNSUPPORTED` error for newer schemas without changing current work. Diagnostics JSON similarly publishes `schemaVersion: 2`, stable error codes, operation status/timings, service-worker state, and any completed, rolled-back, or partial folder writes; it never embeds source bytes.

## Development Checks

```bash
rtk node -c app.js
rtk node -c version.js
rtk node tests/release-consistency.test.js
rtk node tests/export-regression.test.js
rtk node tests/a11y-labels.test.js
rtk node tests/csp-shell.test.js
rtk python tests/browser-preset-smoke.py
rtk node -c sw.js
```

## Supported Formats

| Format | Input | Output | Notes |
|--------|-------|--------|-------|
| PNG | Yes | Yes | Default output format |
| JPG | Yes | Yes | Background fill for transparency |
| WebP | Yes | Yes | Feature-detected; hidden when unsupported |
| AVIF | Yes | Yes | Feature-detected; Chrome 124+ only |
| SVG | Yes | Yes | Output includes dark-mode CSS |
| ICO | Yes | Yes | Multi-resolution favicon file |
| GIF | Yes | - | Input only |
| BMP | Yes | - | Input only |
| TIFF | Yes | - | Input only |

## Preset Sizes

| Preset | Sizes | Use Case |
|--------|-------|----------|
| Modern Web | 16, 32, 48, 180, 192, 512 | favicon.ico, SVG favicon, apple-touch-icon, manifest icons |
| PWA | 72-512 icons + 40 startup images | Any + maskable icons, optional monochrome silhouette, current iOS/iPadOS splash images, web manifest |
| Extension | 16, 32, 48, 128 | Chrome/Firefox extension icons |
| Android | mdpi-xxxhdpi adaptive + legacy buckets | Foreground/background/regular/round/monochrome PNGs, v26/v33 adaptive XML, and AndroidManifest handoff |
| iOS | 180, 512 + app icon matrix | Full AppIcon.appiconset with Contents.json |
| Windows | 70, 150, 310, 310x150 | Windows tile images and browserconfig.xml |
| All Sizes | 16-512 standard set | Complete coverage |

Custom sizes up to 4096x4096 can be added.

## Browser Support

- Chrome/Edge 99+
- Firefox 112+
- Safari 16.4+

WebP and AVIF output are feature-detected and hidden on unsupported browsers.

The browser smoke matrix runs versioned PNG/JPEG/WebP/SVG/ICO/BMP/TIFF fixtures, EXIF orientation, malformed and mismatched inputs, pixel-tolerance goldens at 16/32/512 plus maskable/monochrome roles, exact representative Web/ICO/PNG/SVG/ZIP contracts, forced worker fallback, draft recovery, and offline navigation in Chromium, Firefox, and WebKit. Chromium additionally verifies per-role source loading, draft restoration, Android generation, export privacy, and cancellation. It also parses the production install manifest and performs a two-version service-worker transition, proving the reload choice, draft restoration, obsolete-cache cleanup, and offline reopen; engines without equivalent manifest diagnostics are reported as unsupported by the harness. Engine codec gaps such as TIFF, plus AVIF encoding, File System Access, installed-app file handling, OffscreenCanvas, and automation-level offline navigation, are reported as supported or unsupported instead of being assumed.

## Privacy

- Zero network requests during processing
- No cookies, analytics, or telemetry
- EXIF metadata is stripped by canvas re-encoding
- All processing via Canvas 2D API and Web Workers
- Draft settings expire after 30 days; source image bytes remain opt-in and drafts can be disabled, cleared immediately, or cleared after export

## License

MIT
