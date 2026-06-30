const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

assert(html.includes('<link rel="stylesheet" href="styles.css">'), 'index.html should load external styles.css');
assert(html.includes('<script src="app.js" defer></script>'), 'index.html should load external app.js with defer');
assert(html.includes('id="diagnosticsSection"'), 'index.html should include diagnostics section');
assert(html.includes('id="diagnosticsGrid"'), 'index.html should include diagnostics metrics grid');
assert(html.includes('id="diagnosticsFeatureList"'), 'index.html should include diagnostics feature list');
assert(html.includes('id="handoffTabs"'), 'index.html should include framework handoff tabs');
assert(html.includes('data-handoff-tab="next"'), 'index.html should include Next.js handoff tab');
assert(html.includes('id="handoffSnippet"'), 'index.html should include framework handoff snippet output');
assert(fs.statSync(path.join(root, 'styles.css')).size > 0, 'styles.css should exist and be non-empty');
assert(fs.statSync(path.join(root, 'app.js')).size > 0, 'app.js should exist and be non-empty');

const cspMatch = html.match(/<meta\s+http-equiv=["']Content-Security-Policy["']\s+content="([^"]+)">/i);
assert(cspMatch, 'Content-Security-Policy meta tag should be present');

const csp = cspMatch[1];
[
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].forEach((directive) => {
  assert(csp.includes(directive), `CSP should include ${directive}`);
});

assert(!/<style\b/i.test(html), 'index.html should not contain inline style blocks');
assert(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'index.html should not contain inline script blocks');
assert(!/<[A-Za-z][^>]*\sstyle=/i.test(html), 'index.html should not contain inline style attributes');
assert(!/<[A-Za-z][^>]*\son[A-Za-z]+=/i.test(html), 'index.html should not contain inline event handlers');
assert(!/https?:\/\//i.test(html), 'runtime shell should not depend on external HTTP(S) assets');

console.log('CSP shell is externalized');
