# IconForge Roadmap

Single-file web app for icon resizing and format conversion (currently a thin `index.html` with empty README). Roadmap defines what a full icon-authoring tool should cover — aimed at developers shipping favicons, app icons, and extension icons.

## Planned Features

### Core Output Bundles
- **Favicon bundle** — `favicon.ico` (multi-res: 16/32/48), `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png`, `manifest.webmanifest` snippet
- **Chrome extension bundle** — 16/32/48/128 PNGs plus ready-to-paste `manifest.json` icon block
- **Android adaptive icon** — foreground + background PNGs with 108dp safe zone, plus `ic_launcher.xml` anydpi-v26 snippet
- **iOS app icon set** — full `AppIcon.appiconset` with `Contents.json`, all required 1x/2x/3x variants
- **PWA set** — 72/96/128/144/152/192/384/512 maskable + any, iOS splash screens, `theme_color` picker
- **Windows tile set** — 70/150/310/310x150 wide with SVG→ICO fallback

### Input & Processing
- **SVG first-class input** — render SVG to bitmap at each required size using browser-native rasterizer (sharpens at small sizes)
- **Smart padding** — auto-detect bounding box of non-transparent pixels, add configurable safe-area margin
- **Maskable preview** — show Android adaptive mask + circle + squircle overlays before export
- **Background fill / drop shadow** — transparent / solid / gradient / subtle shadow for iOS-style "chiclets"
- **Icon aging** — apply brand-accent tint, desaturate, or glass overlay

### Export & DX
- **ZIP bundle** — single download with all sizes + README.txt + manifest snippets
- **Copy-to-clipboard HTML** — `<link rel="icon">` / `<meta>` tags ready to paste into `<head>`
- **Copy manifest JSON** — one-click for MV3 `icons`, PWA `manifest.webmanifest`, Android `ic_launcher`
- **Drop-replace mode** — drop an existing icon folder/zip, IconForge replaces only matching filenames

### Quality
- **Per-size downscaling algorithm** — Lanczos / bicubic / mitchell-netravali per size, default tuned (Lanczos for ≥48px, Mitchell for ≤32px)
- **1-pixel hinting** — round to whole pixels at 16/32 to avoid anti-alias mud
- **Compression** — run PNGs through `upng.js`/`pngquant-wasm` for 40–70% smaller files

## Competitive Research
- **RealFaviconGenerator** — de-facto standard; generates every platform's set. Slow, server-side, requires upload. IconForge should win on client-side, offline, instant.
- **Favicon.io** — minimal emoji/text/upload-to-icon generator; good UX for quick jobs, weak on platform coverage. Borrow the text-to-icon quick path.
- **Icon Kitchen (Android)** — Google-flavored maskable adaptive icon editor; steal the safe-zone overlay UX.
- **pwa-asset-generator (CLI)** — Node-based; confirms demand for scripted bundle generation. Offer an equivalent headless CLI later.

## Nice-to-Haves
- AI background removal (MediaPipe Selfie Segmentation or `@imgly/background-removal`) for photo-to-icon workflow
- Icon preview across real device chrome (iPhone home screen, Android Pixel launcher, Chrome tab, macOS Dock)
- Dark-mode variant generator (auto-invert or brand-alt color swap)
- Animated favicon (.apng / .svg with CSS animation) preview
- Drag-to-rearrange batch queue for generating icons for multiple brands in one session
- GitHub-action `npx iconforge` for CI-generated icon sets from a single SVG

## Open-Source Research (Round 2)

### Related OSS Projects
- itgalaxy/favicons — https://github.com/itgalaxy/favicons — Node.js favicon generator, pure-JS (no ImageMagick), emits Android home, Apple-touch, Apple-startup, HTML head snippets
- ruisaraiva19/favycon — https://github.com/ruisaraiva19/favycon — comprehensive apple-touch-icon + favicon PNG variants across many sizes
- faviator/faviator — https://github.com/faviator/faviator — text-based favicon generator (letter + color + shape) with SVG/JPEG/PNG output and a playground
- rodneylab/open-source-favicon-generation — https://github.com/rodneylab/open-source-favicon-generation — SVG-in → Inkscape + OptiPNG + Scour pipeline, 5-file wide-support set
- romulinux/favicon-generator — https://github.com/romulinux/favicon-generator — PHP image + HTML generator
- RealFaviconGenerator — https://github.com/RealFaviconGenerator/rfg-api-node — API client for the hosted service; its manifest-generation logic is mirror-worthy
- Squircley — https://squircley.app/ (open source) — SVG squircle (iOS-style) generator
- PWA Asset Generator — https://github.com/onderceylan/pwa-asset-generator — Puppeteer-based, generates PWA icons + splash screens from any source

### Features to Borrow
- **Emit web manifest + HTML head snippet** (itgalaxy/favicons, PWA Asset Generator) — users paste one `<link>` block instead of hand-wiring a dozen sizes
- **Text-to-favicon mode** (faviator) — letter + bg color + shape variant for users without a logo ready
- **SVG source-of-truth with PNG fallbacks generated per-size** (rodneylab) — single SVG input, optimize per-size rasterizations with OptiPNG equivalent
- **Apple-startup/splash image matrix** (itgalaxy/favicons, PWA Asset Generator) — all current iPhone/iPad splash sizes with safe-area, light + dark variants
- **Squircle/iOS 17+ continuous-curve mask option** (Squircley) — offer iOS-rounded alongside the default platform mask
- **Adaptive icon foreground/background split** (PWA Asset Generator covers Android) — emit `ic_launcher_foreground.xml` + `background.xml` vectors for Android adaptive icons
- **Maskable icon safe-zone overlay preview** — show the 80% safe-zone circle before export so icons don't get clipped
- **Batch ZIP export with folder structure per platform** (itgalaxy/favicons) — `web/`, `ios/`, `android/`, `windows/` pre-organized
- **Dark-mode favicon variant** via `prefers-color-scheme` media-query in the generated HTML snippet

### Patterns & Architectures Worth Studying
- itgalaxy/favicons's **pure-JS resize path** (sharp + svg2png) — no native/CLI deps, runs in CI without binaries; for a web app, same logic ports to WASM-sharp or Canvas2D
- PWA Asset Generator's **Puppeteer-driven screenshot** pipeline — for splash images, letting Chrome render the exact viewport gives pixel-perfect results vs. hand-computing
- rodneylab's **SVG-in canonical** — keep source as SVG, rasterize at export time; no redundant PNG sources to maintain
- **manifest.json spec compliance** — match the exact `purpose: "maskable"` / `"any"` distinction; lots of generators get this wrong
- Client-side **OffscreenCanvas + WebWorker** for mass raster export so the main thread doesn't hang on 15+ size exports
