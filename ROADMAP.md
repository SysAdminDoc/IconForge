# IconForge Roadmap

No actionable roadmap items remain after the v0.4.0 drain.

Blocked or product-gated items live in `Roadmap_Blocked.md`.

## Research-Driven Additions

- [ ] P1 - Add core export regression tests
  Why: ZIP, ICO, manifest, snippet, filename, and platform bundle behavior is user-critical but currently protected only by manual browser checks.
  Evidence: `index.html:1901`, `index.html:3734`, `index.html:3485`, `index.html:3533`, `index.html:3551`, RealFaviconGenerator, pwa-asset-generator, itgalaxy/favicons
  Touches: `index.html`, new local test harness files
  Acceptance: A local command validates ZIP central directory reads, ICO headers, generated platform filenames, manifest JSON, snippet output, and replacement-template matching without opening a browser.
  Complexity: M

- [ ] P1 - Remove duplicate snippet-generation implementation
  Why: Two same-scope `generateSnippets()` declarations leave dead logic in the file and make future snippet changes easy to apply to the wrong function.
  Evidence: `index.html:3665`, `index.html:3800`
  Touches: `index.html`
  Acceptance: Only one snippet-generation entry point remains, all copy buttons still work, and PWA/extension/Android/iOS/Windows snippets are covered by tests.
  Complexity: S

- [ ] P1 - Add local export validator
  Why: The main competitive gap after v0.4.0 is deployment confidence: users need to know a generated folder/ZIP satisfies the selected platform rules.
  Evidence: RealFaviconGenerator checker, Maskable.app, `index.html:3868`, web.dev manifest and maskable-icon guidance
  Touches: `index.html`
  Acceptance: After generation, a validation panel reports missing files, wrong dimensions, manifest/icon mismatches, maskable safe-zone warnings, and a pass/fail result for the active preset.
  Complexity: L

- [ ] P1 - Add visible service-worker update recovery
  Why: Installed PWA users can remain on an old shell with no visible update/reload path even though `sw.js` handles cache replacement.
  Evidence: `sw.js:1`, `index.html:4064`, Chrome Workbox service-worker update guidance
  Touches: `index.html`, `sw.js`
  Acceptance: When a new service worker is waiting or activated, the app shows a non-blocking update notice with a reload action and keeps offline behavior working.
  Complexity: M

- [ ] P1 - Fix unlabeled source and custom-size controls
  Why: Live DOM audit found visible inputs without accessible labels, weakening the current WCAG baseline.
  Evidence: `#textInput`, `#fontSelect`, `#customWidth`, `#customHeight`, WCAG 2.2 form-label expectations
  Touches: `index.html`
  Acceptance: All visible inputs/selects have programmatic labels, the text/emoji/custom-size flows remain visually unchanged, and an automated accessibility smoke check reports no unlabeled visible form controls.
  Complexity: S

- [ ] P2 - Add richer manifest metadata builder
  Why: Current generated manifests focus on icons; modern PWA handoff benefits from user-controlled name, short name, description, start URL, scope, display, theme/background colors, categories, shortcuts, screenshots, lang, and dir.
  Evidence: `index.html:3734`, W3C Web App Manifest, web.dev add-manifest, pwa-asset-generator
  Touches: `index.html`
  Acceptance: A compact metadata panel feeds generated `manifest.webmanifest`, validates required fields, preserves privacy/local-only behavior, and includes tests for default and edited metadata.
  Complexity: M

- [ ] P2 - Add CSP-compatible script/style split
  Why: A meaningful CSP can prevent accidental network calls and reduce injection risk, but the current inline app structure blocks a strict policy.
  Evidence: `index.html`, `index.html:3109`, MDN CSP guidance
  Touches: `index.html`, new `app.js`, possibly new `styles.css`
  Acceptance: App behavior is unchanged, a CSP meta tag allows only required local/blob/data capabilities, and local generation plus worker resize still pass in-browser smoke tests.
  Complexity: L

- [ ] P2 - Add generation diagnostics panel
  Why: Users need actionable recovery details when a browser lacks AVIF/WebP/File System Access/OffscreenCanvas support or a worker path falls back.
  Evidence: Squoosh codec UI, `index.html:3157`, `index.html:3297`
  Touches: `index.html`
  Acceptance: A diagnostics panel lists browser feature support, selected preset, selected formats, skipped/hidden formats, worker fallback state, generated file count, total bytes, and validation status.
  Complexity: M

- [ ] P2 - Add framework-ready handoff snippets
  Why: Competing build tools win by putting icons in the right framework paths; IconForge can provide the same handoff without becoming framework-specific.
  Evidence: Astro favicons, webpack-pwa-manifest, pwa-asset-generator, `index.html:3800`
  Touches: `index.html`
  Acceptance: Snippet tabs cover plain HTML, Vite, Next.js app router, Astro, Chrome/Firefox MV3, Android, and iOS with generated paths matching the active preset.
  Complexity: M

- [ ] P2 - Add export manifest with checksums
  Why: Generated ZIPs include many files but no machine-readable inventory for review, support, or repeatability.
  Evidence: `index.html:3868`, `index.html:3899`
  Touches: `index.html`
  Acceptance: ZIP and folder exports include `iconforge-export.json` with version, preset, source mode, options, file list, dimensions, MIME types, byte sizes, and SHA-256 hashes.
  Complexity: M

- [ ] P3 - Add generated social preview assets
  Why: Adjacent brand-kit tools generate favicon/app/social assets together, and Open Graph/Twitter images are a natural optional extension of the current platform bundle model.
  Evidence: alonw0/web-asset-generator, fabriziosalmi/brandkit, existing platform bundle architecture
  Touches: `index.html`, README feature table after implementation
  Acceptance: An optional preset exports Open Graph and social preview PNGs with copyable meta tags while leaving default icon workflows unchanged.
  Complexity: M

- [ ] P3 - Add manifest language and direction support
  Why: Full UI translation is not the next priority, but generated web manifests should expose platform-standard `lang` and `dir` fields for international apps.
  Evidence: W3C Web App Manifest, `index.html:3734`
  Touches: `index.html`
  Acceptance: Manifest metadata controls include `lang` and `dir`, generated JSON omits empty optional fields, and tests cover left-to-right and right-to-left values.
  Complexity: S
