# IconForge Roadmap

No actionable roadmap items remain after the v0.4.0 drain.

Blocked or product-gated items live in `Roadmap_Blocked.md`.

## Research-Driven Additions

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
