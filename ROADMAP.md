# IconForge Roadmap

No actionable roadmap items remain after the v0.4.0 drain.

Blocked or product-gated items live in `Roadmap_Blocked.md`.

## Research-Driven Additions

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
