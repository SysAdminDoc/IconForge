# Icon Forge

![Version](https://img.shields.io/badge/version-v0.4.3-58A6FF) ![License](https://img.shields.io/badge/license-MIT-green) ![Platform](https://img.shields.io/badge/platform-Web-58A6FF) ![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)

Generate favicons, PWA icons, mobile app icon sets, Windows tiles, and browser extension assets entirely in your browser. No uploads, no server, no tracking. Works offline.

**[Launch Icon Forge](https://sysadmindoc.github.io/IconForge/)**

## Features

- **Multiple input modes** - upload an image, paste from clipboard, create from text/letter, or pick an emoji
- **All icon formats** - PNG, ICO (multi-resolution), SVG (with dark mode CSS), JPG, WebP, AVIF
- **Platform bundles** - one-click exports for Modern Web, PWA, Chrome Extension, Android adaptive icons, iOS AppIcon.appiconset, Windows tiles, or All Sizes
- **Auto-crop** - detect content bounds and trim whitespace with adjustable tolerance
- **Manual crop** - draw a crop rectangle or enter precise dimensions
- **Maskable preview** - safe-zone overlay with circle, squircle, and rounded-square masks
- **Processing controls** - safe padding, background fill or gradient, drop shadow, tint/desaturate/glass effects, and pixel-hinted small icons
- **Code snippets** - generates HTML `<link>` tags, `manifest.webmanifest` JSON, extension manifest icon blocks, Android XML, iOS Contents.json, and Windows browserconfig.xml
- **Deployable ZIPs** - exports generated images plus README.txt and the platform support files needed by the selected bundle
- **Export validation** - checks generated platform files, dimensions, manifest icon metadata, support files, and maskable safe-zone coverage before deployment
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
rtk node -e "const fs=require('fs'); const html=fs.readFileSync('index.html','utf8'); const m=html.match(/<script>([\s\S]*)<\/script>/); if(!m) throw new Error('script not found'); new Function(m[1]); console.log('script syntax ok');"
rtk node tests/export-regression.test.js
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
| PWA | 72, 96, 128, 144, 152, 192, 384, 512 | Any + maskable icons, iOS splash images, web manifest |
| Extension | 16, 32, 48, 128 | Chrome/Firefox extension icons |
| Android | 192, 512 + adaptive assets | Foreground/background PNGs and adaptive icon XML |
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
