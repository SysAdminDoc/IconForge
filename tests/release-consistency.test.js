const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const versionSource = read('version.js');
const appSource = read('app.js');
const workerSource = read('sw.js');
const html = read('index.html');
const readme = read('README.md');
const changelog = read('CHANGELOG.md');

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

const versionScriptIndex = html.indexOf('<script src="version.js" defer></script>');
const appScriptIndex = html.indexOf('<script src="app.js" defer></script>');
assert(versionScriptIndex >= 0 && appScriptIndex > versionScriptIndex, 'version.js must load before app.js');
assert(readme.includes(`badge/version-${version}-`), `README badge must match ${version}`);
assert(changelog.includes(`## [${version}] - `), `CHANGELOG must include a dated ${version} release heading`);

const metadataMatch = appSource.match(/const PLATFORM_MATRIX_METADATA = Object\.freeze\((\{[\s\S]*?\})\);/);
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
  const match = appSource.match(new RegExp(`const ${constant} = '(https://[^']+)';`));
  assert(match, `${constant} must identify an HTTPS specification source`);
}

const verifiedConstants = [
  'PWA_SPLASH_MATRIX_VERIFIED',
  'ANDROID_ICON_MATRIX_VERIFIED',
  'IOS_ICON_MATRIX_VERIFIED'
];
for (const constant of verifiedConstants) {
  const match = appSource.match(new RegExp(`const ${constant} = '(\\d{4}-\\d{2}-\\d{2})';`));
  assert(match, `${constant} must use an absolute YYYY-MM-DD date`);
  assert(!Number.isNaN(Date.parse(`${match[1]}T00:00:00Z`)), `${constant} must contain a real calendar date`);
}

console.log(`release surfaces match ${version}; platform matrices include source and verification metadata`);
