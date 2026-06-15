# Icon Forge

![License](https://img.shields.io/badge/license-MIT-green) ![Platform](https://img.shields.io/badge/platform-Web-58A6FF) ![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)

Generate favicons, PWA icons, and browser extension assets — entirely in your browser. No uploads, no server, no tracking. Works offline.

## Features

- **Multiple input modes** — upload an image, paste from clipboard (Ctrl+V), create from text/letter, or pick an emoji
- **All icon formats** — PNG, ICO (multi-resolution), SVG (with dark mode CSS), JPG, WebP, AVIF
- **Smart presets** — one-click bundles for Modern Web, PWA, Chrome Extension, or All Sizes
- **Auto-crop** — detect content bounds and trim whitespace with adjustable tolerance
- **Manual crop** — draw a crop rectangle or enter precise dimensions
- **Code snippets** — generates HTML `<link>` tags and `manifest.webmanifest` JSON, ready to copy-paste
- **Batch export** — download all sizes as a ZIP, or save directly to a folder (Chrome/Edge)
- **File size display** — see per-icon and total file sizes after generation
- **SVG dark mode** — generates SVG favicons with embedded `prefers-color-scheme` CSS
- **Offline PWA** — install as a Progressive Web App, works without internet
- **100% client-side** — all processing happens in your browser via Canvas and Web Workers

## Getting Started

1. Open `index.html` in any modern browser
2. Upload an image (or use text/emoji mode)
3. Select sizes and formats (or pick a preset)
4. Click **Generate Icons**
5. Download individually, as ZIP, or copy the HTML/manifest snippets

No build step, no package manager, no dependencies.

## Supported Formats

| Format | Input | Output | Notes |
|--------|-------|--------|-------|
| PNG | Yes | Yes | Default output format |
| JPG | Yes | Yes | White background fill for transparency |
| WebP | Yes | Yes | Feature-detected; hidden on Safari |
| AVIF | Yes | Yes | Feature-detected; Chrome 124+ only |
| SVG | Yes | Yes | Output includes dark-mode CSS |
| ICO | Yes | Yes | Multi-resolution (16/32/48 in one file) |
| GIF | Yes | — | Input only |
| BMP | Yes | — | Input only |
| TIFF | Yes | — | Input only |

## Preset Sizes

| Preset | Sizes | Use Case |
|--------|-------|----------|
| Modern Web | 32, 180 | favicon.ico + apple-touch-icon |
| PWA | 192, 512 | Web app manifest icons |
| Extension | 16, 32, 48, 128 | Chrome/Firefox extension |
| All Sizes | 16–512 (9 sizes) | Complete coverage |

Custom sizes up to 4096×4096 can be added.

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
