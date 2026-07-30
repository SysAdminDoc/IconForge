const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const versionSource = read('version.js');
const appSource = read('app.js');
const platformSource = read('core/platform.js');
const workerSource = read('sw.js');
const html = read('index.html');
const readme = read('README.md');
const changelog = read('CHANGELOG.md');
const manifest = JSON.parse(read('manifest.webmanifest'));

function readPngDimensions(name) {
  const bytes = fs.readFileSync(path.join(root, name));
  assert(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${name} must be a PNG`);
  assert.strictEqual(bytes.subarray(12, 16).toString('ascii'), 'IHDR', `${name} must start with a PNG IHDR chunk`);
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20)
  };
}

const versionMatch = versionSource.match(/^globalThis\.ICONFORGE_VERSION = '(v\d+\.\d+\.\d+)';\s*$/);
assert(versionMatch, 'version.js must contain the single canonical vMAJOR.MINOR.PATCH declaration');
const version = versionMatch[1];

assert.strictEqual(
  (appSource.match(/v\d+\.\d+\.\d+/g) || []).length,
  0,
  'app.js must consume the canonical version without embedding a release literal'
);
assert(appSource.includes('const APP_VERSION = globalThis.ICONFORGE_VERSION;'));
assert(workerSource.startsWith("importScripts('./version.js');"), 'service worker must load canonical version before declaring its cache');
assert(workerSource.includes('const CACHE_NAME = `iconforge-${globalThis.ICONFORGE_VERSION}`;'));
assert(workerSource.includes("'./version.js'"), 'service worker shell cache must include version.js');
assert(workerSource.includes("keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))"), 'activation must remove obsolete version caches');
assert(workerSource.includes("e.data?.type === 'SKIP_WAITING'"), 'waiting workers must support user-controlled activation');
const updateAction = appSource.match(/btnReloadUpdate\.addEventListener\('click', \(\) => \{([\s\S]*?)\n\}\);/)?.[1] || '';
assert(updateAction.includes('saveDraftState({ silent: true })'), 'update reload must preserve an eligible draft first');
assert(updateAction.includes("postMessage({ type: 'SKIP_WAITING' })"), 'reload action must activate a waiting worker');
assert(!appSource.match(/watchServiceWorker[\s\S]{0,1400}postMessage\(\{ type: 'SKIP_WAITING'/), 'worker discovery must not activate updates without the reload action');

const requiredProductionIcons = [
  { size: 192, purpose: 'any' },
  { size: 512, purpose: 'any' },
  { size: 512, purpose: 'maskable' }
];
for (const requirement of requiredProductionIcons) {
  const icon = manifest.icons.find((candidate) => (
    candidate.sizes === `${requirement.size}x${requirement.size}` &&
    candidate.type === 'image/png' &&
    candidate.purpose.split(/\s+/).includes(requirement.purpose)
  ));
  assert(icon, `production manifest must declare a ${requirement.size}px ${requirement.purpose} PNG`);
  assert.deepStrictEqual(
    readPngDimensions(icon.src),
    { width: requirement.size, height: requirement.size },
    `${icon.src} dimensions must match its manifest declaration`
  );
  assert(workerSource.includes(`'./${icon.src}'`), `${icon.src} must be cached by the service worker`);
}
assert.strictEqual(
  new Set(manifest.icons.map((icon) => icon.src)).size,
  manifest.icons.length,
  'production manifest icon paths must be unique'
);

const shellThemeColor = html.match(/<meta name="theme-color" content="(#[0-9a-fA-F]{6})">/)?.[1];
const cssBackgroundColor = read('styles.css').match(/--bg-dark:\s*(#[0-9a-fA-F]{6});/)?.[1];
assert(shellThemeColor, 'shell must declare a six-digit theme-color');
assert(cssBackgroundColor, 'styles must declare a six-digit --bg-dark color');
assert.strictEqual(manifest.theme_color, shellThemeColor, 'manifest and shell theme colors must agree');
assert.strictEqual(manifest.background_color, shellThemeColor, 'manifest background and shell theme colors must agree');
assert.strictEqual(cssBackgroundColor, shellThemeColor, 'CSS background and shell theme colors must agree');

const versionScriptIndex = html.indexOf('<script src="version.js"></script>');
const appScriptIndex = html.indexOf('<script type="module" src="app.js"></script>');
assert(versionScriptIndex >= 0 && appScriptIndex > versionScriptIndex, 'version.js must load before app.js');
assert(readme.includes(`badge/version-${version}-`), `README badge must match ${version}`);
assert(changelog.includes(`## [${version}] - `), `CHANGELOG must include a dated ${version} release heading`);

const metadataMatch = platformSource.match(/const PLATFORM_MATRIX_METADATA = Object\.freeze\((\{[\s\S]*?\})\);/);
assert(metadataMatch, 'platform matrices must declare shared source and verification metadata');
for (const key of ['pwaSplash', 'androidIcons', 'iosIcons']) {
  assert(metadataMatch[1].includes(`${key}:`), `${key} matrix metadata is missing`);
}

const sourceConstants = [
  'PWA_SPLASH_MATRIX_SOURCE',
  'ANDROID_ICON_MATRIX_SOURCE',
  'IOS_ICON_MATRIX_SOURCE'
];
for (const constant of sourceConstants) {
  const match = platformSource.match(new RegExp(`const ${constant} = '(https://[^']+)';`));
  assert(match, `${constant} must identify an HTTPS specification source`);
}

const verifiedConstants = [
  'PWA_SPLASH_MATRIX_VERIFIED',
  'ANDROID_ICON_MATRIX_VERIFIED',
  'IOS_ICON_MATRIX_VERIFIED'
];
for (const constant of verifiedConstants) {
  const match = platformSource.match(new RegExp(`const ${constant} = '(\\d{4}-\\d{2}-\\d{2})';`));
  assert(match, `${constant} must use an absolute YYYY-MM-DD date`);
  assert(!Number.isNaN(Date.parse(`${match[1]}T00:00:00Z`)), `${constant} must contain a real calendar date`);
}

console.log(`release surfaces match ${version}; production PWA identity and platform metadata are consistent`);
