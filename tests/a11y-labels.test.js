const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const documentHtml = html;
const labelForIds = new Set(
  Array.from(documentHtml.matchAll(/<label\b[^>]*\bfor=["']([^"']+)["'][^>]*>/gi), (match) => match[1])
);

function attrs(tag) {
  const out = {};
  for (const match of tag.matchAll(/\s([^\s=]+)(?:=["']([^"']*)["'])?/g)) {
    out[match[1].toLowerCase()] = match[2] || '';
  }
  return out;
}

function isWrappedByLabel(index) {
  const before = documentHtml.slice(0, index);
  const lastOpen = before.lastIndexOf('<label');
  const lastClose = before.lastIndexOf('</label>');
  if (lastOpen === -1 || lastOpen < lastClose) return false;
  const nextClose = documentHtml.indexOf('</label>', index);
  return nextClose !== -1;
}

const unlabeled = [];
const controls = documentHtml.matchAll(/<(input|select|textarea)\b[^>]*>/gi);
for (const match of controls) {
  const tag = match[0];
  const controlAttrs = attrs(tag);
  const type = (controlAttrs.type || '').toLowerCase();
  if (type === 'hidden') continue;
  if (controlAttrs['aria-hidden'] === 'true') continue;

  const id = controlAttrs.id || '';
  const labeled = Boolean(controlAttrs['aria-label'])
    || Boolean(controlAttrs['aria-labelledby'])
    || (id && labelForIds.has(id))
    || isWrappedByLabel(match.index);

  if (!labeled) {
    unlabeled.push(id || tag);
  }
}

assert.deepStrictEqual(unlabeled, []);

const snippetTabs = Array.from(documentHtml.matchAll(/<button\b[^>]*\bdata-handoff-tab=["'][^"']+["'][^>]*>/gi), (match) => match[0]);
assert.strictEqual(snippetTabs.length, 8, 'handoff snippet tab count should match the supported snippets');

const snippetTabIds = new Set();
let selectedSnippetTabs = 0;
for (const tabTag of snippetTabs) {
  const tabAttrs = attrs(tabTag);
  assert.strictEqual(tabAttrs.role, 'tab', `${tabAttrs['data-handoff-tab']} should expose role=tab`);
  assert(tabAttrs.id, `${tabAttrs['data-handoff-tab']} tab should have a stable id`);
  assert.strictEqual(tabAttrs['aria-controls'], 'handoffSnippet', `${tabAttrs.id} should control the handoff snippet panel`);
  assert(['true', 'false'].includes(tabAttrs['aria-selected']), `${tabAttrs.id} should declare aria-selected`);
  if (tabAttrs['aria-selected'] === 'true') {
    selectedSnippetTabs += 1;
    assert.strictEqual(tabAttrs.tabindex, '0', `${tabAttrs.id} should be tabbable when selected`);
  } else {
    assert.strictEqual(tabAttrs.tabindex, '-1', `${tabAttrs.id} should use roving tabindex when inactive`);
  }
  snippetTabIds.add(tabAttrs.id);
}
assert.strictEqual(selectedSnippetTabs, 1, 'exactly one handoff snippet tab should be selected by default');

const handoffPanelTag = documentHtml.match(/<pre\b[^>]*\bid=["']handoffSnippet["'][^>]*>/i);
assert(handoffPanelTag, 'handoff snippet panel should exist');
const handoffPanelAttrs = attrs(handoffPanelTag[0]);
assert.strictEqual(handoffPanelAttrs.role, 'tabpanel');
assert.strictEqual(handoffPanelAttrs.tabindex, '0');
assert(snippetTabIds.has(handoffPanelAttrs['aria-labelledby']), 'handoff snippet panel should be labelled by a tab id');

const i18nKeys = new Set(
  Array.from(documentHtml.matchAll(/\bdata-i18n=["']([^"']+)["']/gi), (match) => match[1])
);
[
  'shell.appName',
  'shell.tagline',
  'shell.trustSignal',
  'shell.sourceImage',
  'shell.draftRecovery',
  'shell.draftPrivacy'
].forEach((key) => assert(i18nKeys.has(key), `${key} should be wired to the UI string catalog`));

console.log('visible form controls have labels');
console.log('handoff snippet tabs expose tabpanel relationships');
console.log('shell text has catalog hooks');
