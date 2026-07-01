# IconForge Roadmap

No actionable roadmap items remain after the v0.4.10 research-driven drain.

Blocked or product-gated items live in `Roadmap_Blocked.md`.

## Research-Driven Additions

### P3

- [ ] P3 — Introduce a UI string catalog before localization
  Why: Manifest `lang`/`dir` export exists, but the app UI is hard-coded English; a catalog is the prerequisite for future translations without changing behavior now.
  Evidence: `index.html`; `app.js`; W3C Web App Manifest language/direction support.
  Touches: `index.html`; `app.js`; `tests/a11y-labels.test.js`
  Acceptance: User-visible strings used by the shell, statuses, diagnostics, validation, snippets, and errors flow through a single catalog while default English output remains unchanged and tests still pass.
  Complexity: L
