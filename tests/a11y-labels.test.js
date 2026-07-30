const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
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

const sourceTabs = Array.from(documentHtml.matchAll(/<button\b[^>]*\bdata-mode=["'](upload|text|emoji)["'][^>]*>/gi), (match) => match[0]);
assert.strictEqual(sourceTabs.length, 3, 'source mode tab count should match the three input modes');
let selectedSourceTabs = 0;
const sourceTabIds = new Set();
for (const tabTag of sourceTabs) {
  const tabAttrs = attrs(tabTag);
  assert.strictEqual(tabAttrs.role, 'tab', `${tabAttrs['data-mode']} source mode should expose role=tab`);
  assert(tabAttrs.id, `${tabAttrs['data-mode']} source tab should have a stable id`);
  assert(tabAttrs['aria-controls'], `${tabAttrs.id} should identify its tab panel`);
  assert(['true', 'false'].includes(tabAttrs['aria-selected']), `${tabAttrs.id} should declare aria-selected`);
  if (tabAttrs['aria-selected'] === 'true') {
    selectedSourceTabs += 1;
    assert.strictEqual(tabAttrs.tabindex, '0');
  } else {
    assert.strictEqual(tabAttrs.tabindex, '-1');
  }
  sourceTabIds.add(tabAttrs.id);
  const panelTag = documentHtml.match(new RegExp(`<div\\b[^>]*\\bid=["']${tabAttrs['aria-controls']}["'][^>]*>`, 'i'));
  assert(panelTag, `${tabAttrs.id} should control an existing panel`);
  const panelAttrs = attrs(panelTag[0]);
  assert.strictEqual(panelAttrs.role, 'tabpanel');
  assert.strictEqual(panelAttrs['aria-labelledby'], tabAttrs.id);
  assert.strictEqual(panelAttrs.tabindex, '0');
}
assert.strictEqual(selectedSourceTabs, 1, 'exactly one source tab should be selected by default');

const workflowSteps = Array.from(documentHtml.matchAll(/<div\b[^>]*\bdata-workflow-step=["'](source|configure|export)["'][^>]*>/gi), (match) => attrs(match[0]));
assert.strictEqual(workflowSteps.length, 3, 'workflow rail should expose Source, Configure, and Export steps');
assert.strictEqual(workflowSteps.filter((step) => step['aria-current'] === 'step').length, 1, 'workflow rail should expose exactly one current step');
assert.strictEqual(workflowSteps.find((step) => step['aria-current'] === 'step')['data-workflow-step'], 'source');

const shapeButtons = Array.from(documentHtml.matchAll(/<button\b[^>]*\bdata-shape=["'](rounded|circle|square)["'][^>]*>/gi), (match) => attrs(match[0]));
assert.strictEqual(shapeButtons.length, 6, 'text and emoji source tools should each expose three shape toggles');
assert.strictEqual(shapeButtons.filter((button) => button['aria-pressed'] === 'true').length, 2, 'each shape group should expose one default pressed toggle');
assert(shapeButtons.every((button) => ['true', 'false'].includes(button['aria-pressed'])), 'every shape toggle should declare aria-pressed');
assert(app.includes("btn.setAttribute('aria-pressed', String(selected));"), 'runtime selection changes should synchronize aria-pressed');
assert(app.includes("uiText('runtime.downloadFile', { name: fileName })"), 'generated downloads should localize an accessible name that includes the filename');
assert(app.includes("uiText('runtime.copyFile', { name: fileName })"), 'generated copy actions should localize an accessible name that includes the filename');

const reviewMaskButtons = Array.from(documentHtml.matchAll(/<button\b[^>]*\bdata-review-mask=["'](none|circle|squircle|rounded)["'][^>]*>/gi), (match) => attrs(match[0]));
assert.strictEqual(reviewMaskButtons.length, 4, 'legibility review should expose four adaptive-mask previews');
assert.strictEqual(reviewMaskButtons.filter((button) => button['aria-pressed'] === 'true').length, 1, 'legibility review should expose one selected mask');
assert(reviewMaskButtons.every((button) => ['true', 'false'].includes(button['aria-pressed'])), 'legibility mask buttons should expose pressed state');

const sourceTabList = documentHtml.match(/<div\b[^>]*\bclass=["'][^"']*\binput-mode-tabs\b[^"']*["'][^>]*>/i);
assert(sourceTabList, 'source tablist should exist');
assert.strictEqual(attrs(sourceTabList[0]).role, 'tablist');

const statusTag = documentHtml.match(/<div\b[^>]*\bid=["']status["'][^>]*>/i);
assert(statusTag, 'status surface should exist');
assert.strictEqual(attrs(statusTag[0]).tabindex, '-1', 'status surface should accept programmatic error focus');
assert.strictEqual(attrs(statusTag[0])['aria-live'], 'polite');

function hexLuminance(hex) {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(first, second) {
  const a = hexLuminance(first);
  const b = hexLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function cssColorVariable(name) {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'));
  assert(match, `CSS color variable --${name} should exist`);
  return match[1];
}

const mutedColor = cssColorVariable('text-muted');
for (const surface of ['bg-dark', 'bg-card', 'bg-hover']) {
  const ratio = contrastRatio(mutedColor, cssColorVariable(surface));
  assert(ratio >= 4.5, `--text-muted should meet 4.5:1 against --${surface}; received ${ratio.toFixed(2)}:1`);
}
assert(css.includes('button:focus-visible'), 'interactive controls should have an explicit focus-visible rule');

const i18nKeys = new Set(
  Array.from(documentHtml.matchAll(/\bdata-i18n=["']([^"']+)["']/gi), (match) => match[1])
);
[
  'shell.appName',
  'shell.tagline',
  'shell.trustSignal',
  'shell.interfaceLanguage',
  'shell.english',
  'shell.pseudoExpanded',
  'shell.pseudoRtl',
  'shell.sourceImage',
  'shell.draftRecovery',
  'shell.draftPrivacy'
].forEach((key) => assert(i18nKeys.has(key), `${key} should be wired to the UI string catalog`));

console.log('visible form controls have labels');
console.log('handoff snippet tabs expose tabpanel relationships');
console.log('source tabs expose keyboard relationships and muted text meets contrast');
console.log('selection, workflow, and output actions expose stateful semantics');
console.log('shell text has catalog hooks');
