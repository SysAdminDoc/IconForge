# Icon Forge

![Version](https://img.shields.io/badge/version-v0.4.16-58A6FF) ![License](https://img.shields.io/badge/license-MIT-green) ![Platform](https://img.shields.io/badge/platform-Web-58A6FF) ![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)

Generate favicons, PWA icons, mobile app icon sets, Windows tiles, and browser extension assets entirely in your browser. No uploads, no server, no tracking. Works offline.

**[Launch Icon Forge](https://sysadmindoc.github.io/IconForge/)**

## Features

- **Multiple input modes** - upload an image, paste from clipboard, create from text/letter, or pick an emoji
- **All icon formats** - PNG, ICO (multi-resolution), SVG (with dark mode CSS), JPG, WebP, AVIF
- **Platform bundles** - one-click exports for Modern Web, PWA, Chrome Extension, Android adaptive icons, iOS AppIcon.appiconset, Windows tiles, or All Sizes
- **Social previews** - optional Open Graph, Twitter, and LinkedIn preview PNGs with copyable meta tags
- **Auto-crop** - detect content bounds and trim whitespace with adjustable tolerance
- **Manual crop** - draw a crop rectangle or enter precise dimensions
- **Maskable preview** - safe-zone overlay with circle, squircle, and rounded-square masks
- **Processing controls** - safe padding, background fill or gradient, drop shadow, tint/desaturate/glass effects, and pixel-hinted small icons
- **Code snippets** - generates HTML `<link>` tags, `manifest.webmanifest` JSON, extension manifest icon blocks, Android XML, iOS Contents.json, and Windows browserconfig.xml
- **Framework handoffs** - tabbed snippets for plain HTML, Vite, Next.js app router, Astro, Chrome/Firefox MV3, Android, and iOS
- **Deployment URL controls** - generate root-relative, relative, or custom-base asset URLs with optional SHA-256 cache-busting queries
- **Input and encoder guardrails** - rejects malformed/external SVG input and prevents empty canvas blobs from entering exports
- **Manifest metadata** - set app name, description, start URL, display mode, categories, theme colors, shortcuts, screenshots, language, and direction for generated web manifests
- **CSP-hardened shell** - local CSS and JavaScript files run under a strict self-only policy with blob/data allowances for previews, downloads, and workers
- **Deployable ZIPs** - exports generated images plus README.txt and the platform support files needed by the selected bundle
- **Export manifest** - ZIP and folder exports include `iconforge-export.json` with file inventory, dimensions, MIME types, byte sizes, and SHA-256 hashes
- **Export validation** - checks generated platform files, dimensions, manifest icon metadata, support files, and maskable safe-zone coverage before deployment
- **Generation diagnostics** - reports browser feature support, selected preset/formats, skipped formats, worker fallback state, file count, byte total, and validation status
- **Drop-replace template matching** - load an existing folder or ZIP filename map and export only matching generated assets
- **File size display** - see per-icon and total file sizes after generation
- **SVG dark mode** - generates SVG favicons with embedded `prefers-color-scheme` CSS
- **Offline PWA** - install as a Progressive Web App, works without internet, and shows a reload notice when an update is ready
- **100% client-side** - all processing happens in your browser via Canvas and Web Workers

## Getting Started

1. Go to **[sysadmindoc.github.io/IconForge](https://sysadmindoc.github.io/IconForge/)** or open `index.html` locally.
2. Upload an image, use text mode, or use emoji mode.
3. Select sizes and formats, or pick a platform preset.
4. Click **Generate Icons**.
5. Download individually, download a deployable ZIP, save to a folder, or copy the generated snippets.

No build step, no package manager, no dependencies.

## Development Checks

```bash
rtk node -c app.js
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
| PWA | 72-512 icons + 38 startup images | Any + maskable icons, current iOS/iPadOS splash images, web manifest |
| Extension | 16, 32, 48, 128 | Chrome/Firefox extension icons |
| Android | mdpi-xxxhdpi adaptive + legacy buckets | Foreground/background/legacy PNGs and adaptive icon XML |
| iOS | 180, 512 + app icon matrix | Full AppIcon.appiconset with Contents.json |
| Windows | 70, 150, 310, 310x150 | Windows tile images and browserconfig.xml |
| All Sizes | 16-512 standard set | Complete coverage |

Custom sizes up to 4096x4096 can be added.

## Browser Support

- Chrome/Edge 99+
- Firefox 112+
- Safari 16.4+

WebP and AVIF output are feature-detected and hidden on unsupported browsers.

## Privacy

- Zero network requests during processing
- No cookies, analytics, or telemetry
- EXIF metadata is stripped by canvas re-encoding
- All processing via Canvas 2D API and Web Workers

## License

MIT
