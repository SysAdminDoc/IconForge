const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const documentHtml = html.split('<script>')[0];
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
const controls = documentHtml.matchAll(/<(input|select)\b[^>]*>/gi);
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
console.log('visible form controls have labels');
