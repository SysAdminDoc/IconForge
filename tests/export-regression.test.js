const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);

assert(scriptMatch, 'inline application script not found');

class ClassListMock {
  constructor() {
    this.classes = new Set();
  }

  add(...names) {
    names.forEach((name) => this.classes.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.classes.delete(name));
  }

  toggle(name, force) {
    if (force === undefined) {
      if (this.classes.has(name)) {
        this.classes.delete(name);
        return false;
      }
      this.classes.add(name);
      return true;
    }
    if (force) this.classes.add(name);
    else this.classes.delete(name);
    return Boolean(force);
  }
}

class ContextMock {
  constructor() {
    this.fillStyle = '';
    this.textAlign = '';
    this.textBaseline = '';
    this.font = '';
    this.imageSmoothingEnabled = true;
    this.imageSmoothingQuality = 'high';
    this.globalAlpha = 1;
    this.filter = 'none';
  }

  clearRect() {}
  fillRect() {}
  drawImage() {}
  fillText() {}
  save() {}
  restore() {}
  beginPath() {}
  arc() {}
  roundRect() {}
  rect() {}
  clip() {}
  stroke() {}
  fill() {}
  moveTo() {}
  lineTo() {}
  quadraticCurveTo() {}
  closePath() {}
  createLinearGradient() {
    return { addColorStop() {} };
  }
  getImageData() {
    return { data: new Uint8ClampedArray(4) };
  }
}

class ElementMock {
  constructor(tagName = 'div', id = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.style = {};
    this.dataset = {};
    this.children = [];
    this.attributes = {};
    this.classList = new ClassListMock();
    this.className = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.textContent = '';
    this.innerHTML = '';
    this.type = '';
    this.width = 1;
    this.height = 1;
    this.naturalWidth = 1;
    this.naturalHeight = 1;
  }

  addEventListener() {}
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    this.children = this.children.filter((item) => item !== child);
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[key] = String(value);
    }
  }
  getAttribute(name) {
    return this.attributes[name] || null;
  }
  click() {}
  focus() {}
  closest() {
    return this;
  }
  querySelector() {
    return new ElementMock('button');
  }
  querySelectorAll() {
    return [];
  }
  getContext() {
    return new ContextMock();
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: this.width || 1, height: this.height || 1 };
  }
  toBlob(callback, type = 'image/png') {
    callback(new Blob([new Uint8Array([0])], { type }));
  }
  toDataURL(type = 'image/png') {
    return `data:${type};base64,AA==`;
  }
}

function createDocumentMock() {
  const elements = new Map();
  const defaults = {
    backgroundColor: '#123456',
    backgroundColor2: '#654321',
    backgroundMode: 'solid',
    safePaddingSlider: '0',
    safePaddingValue: '0%',
    resampleSelect: 'auto',
    effectSelect: 'none',
    maskShapeSelect: 'circle',
    textInput: 'A',
    fontSelect: 'Arial',
    textColor: '#ffffff',
    textBgColor: '#111111',
    emojiBgColor: '#111111',
    svgLightColor: '#111111',
    svgDarkColor: '#ffffff',
    toleranceSlider: '10',
    toleranceValue: '10'
  };

  function elementFor(id) {
    if (!elements.has(id)) {
      const el = new ElementMock(id.toLowerCase().includes('canvas') ? 'canvas' : 'div', id);
      if (Object.prototype.hasOwnProperty.call(defaults, id)) el.value = defaults[id];
      if (id === 'dropShadowToggle') el.checked = false;
      elements.set(id, el);
    }
    return elements.get(id);
  }

  return {
    body: new ElementMock('body'),
    addEventListener() {},
    createElement(tagName) {
      return new ElementMock(tagName);
    },
    createTextNode(text) {
      const node = new ElementMock('#text');
      node.textContent = text;
      return node;
    },
    getElementById: elementFor,
    querySelector(selector) {
      return elementFor(selector.replace(/[^a-zA-Z0-9_-]/g, '') || 'query');
    },
    querySelectorAll() {
      return [];
    }
  };
}

function loadApp() {
  const document = createDocumentMock();
  const context = {
    console,
    Blob,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Uint8ClampedArray,
    Uint32Array,
    ArrayBuffer,
    DataView,
    Math,
    JSON,
    Promise,
    Error,
    Set,
    Map,
    Object,
    Array,
    parseInt,
    document,
    navigator: {
      clipboard: { writeText: async () => {} },
      serviceWorker: {
        controller: null,
        addEventListener() {},
        register: async () => ({
          waiting: null,
          installing: null,
          addEventListener() {},
          update: async () => {}
        })
      }
    },
    location: { reload() {} },
    URL: {
      createObjectURL: () => 'blob:iconforge-test',
      revokeObjectURL: () => {}
    },
    Image: class {
      constructor() {
        this.naturalWidth = 256;
        this.naturalHeight = 256;
        this.onload = null;
      }
      set src(value) {
        this._src = value;
        if (this.onload) this.onload();
      }
      get src() {
        return this._src;
      }
    },
    FileReader: class {},
    setTimeout,
    clearTimeout,
    __ICONFORGE_ENABLE_TEST_API__: true
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(scriptMatch[1], context, { filename: 'index.html' });
  assert(context.window.__ICONFORGE_TEST__, 'test API was not exposed');
  return context.window.__ICONFORGE_TEST__;
}

async function blobBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

function readZipCentralDirectory(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  assert.notStrictEqual(eocd, -1, 'ZIP EOCD not found');

  const totalEntries = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const names = [];
  const decoder = new TextDecoder();

  for (let i = 0; i < totalEntries; i += 1) {
    assert.strictEqual(view.getUint32(offset, true), 0x02014b50, 'central directory signature mismatch');
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));

    assert.strictEqual(compressedSize, uncompressedSize, `${name} should use STORE mode`);
    assert.strictEqual(view.getUint32(localOffset, true), 0x04034b50, `${name} local header missing`);
    names.push(name);
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return names;
}

function makeBlob(size = 4, type = 'image/png') {
  return new Blob([new Uint8Array(size).fill(7)], { type });
}

function makePwaBundleFiles() {
  const iconSizes = [72, 96, 128, 144, 152, 192, 384, 512];
  const splashSpecs = [
    { width: 640, height: 1136, name: 'iphone-se' },
    { width: 750, height: 1334, name: 'iphone-8' },
    { width: 828, height: 1792, name: 'iphone-11' },
    { width: 1179, height: 2556, name: 'iphone-14-pro' },
    { width: 1536, height: 2048, name: 'ipad' },
    { width: 2048, height: 2732, name: 'ipad-pro' }
  ];
  return [
    ...iconSizes.flatMap((px) => [
      { name: `pwa/icons/icon-${px}x${px}.png`, blob: makeBlob(), size: { width: px, height: px }, format: 'png', purpose: 'any' },
      { name: `pwa/icons/icon-maskable-${px}x${px}.png`, blob: makeBlob(), size: { width: px, height: px }, format: 'png', purpose: 'maskable' }
    ]),
    ...splashSpecs.flatMap((splash) => [
      {
        name: `pwa/splash/apple-splash-${splash.name}-${splash.width}x${splash.height}.png`,
        blob: makeBlob(),
        size: { width: splash.width, height: splash.height },
        format: 'png',
        role: 'splash'
      },
      {
        name: `pwa/splash/apple-splash-${splash.name}-${splash.height}x${splash.width}.png`,
        blob: makeBlob(),
        size: { width: splash.height, height: splash.width },
        format: 'png',
        role: 'splash'
      }
    ])
  ];
}

async function main() {
  const api = loadApp();

  const zipBlob = api.buildZip([
    { name: 'pwa/icons/icon-192x192.png', data: new Uint8Array([1, 2, 3]) },
    { name: 'snippets/head.html', data: new TextEncoder().encode('<link rel="manifest">') }
  ]);
  assert.deepStrictEqual(readZipCentralDirectory(await blobBytes(zipBlob)), [
    'pwa/icons/icon-192x192.png',
    'snippets/head.html'
  ]);

  const icoBytes = await blobBytes(api.createICO([
    { width: 16, height: 16, data: new Uint8Array([137, 80, 78, 71]) },
    { width: 256, height: 256, data: new Uint8Array([1, 2, 3, 4, 5]) }
  ]));
  const icoView = new DataView(icoBytes.buffer, icoBytes.byteOffset, icoBytes.byteLength);
  assert.strictEqual(icoView.getUint16(0, true), 0, 'ICO reserved header should be zero');
  assert.strictEqual(icoView.getUint16(2, true), 1, 'ICO type should be icon');
  assert.strictEqual(icoView.getUint16(4, true), 2, 'ICO image count should match inputs');
  assert.strictEqual(icoView.getUint8(6), 16, 'ICO first width should be literal');
  assert.strictEqual(icoView.getUint8(22), 0, 'ICO 256px width should be encoded as zero');
  assert.strictEqual(icoView.getUint32(18, true), 38, 'ICO second payload offset should follow the first entry data');

  api.setState({ sourceFileName: 'Acme Brand', activePresetKey: 'web' });
  assert.strictEqual(api.getOutputFileName({ format: 'ico', size: { width: 'multi', height: 'multi' } }), 'favicon.ico');
  assert.strictEqual(api.getOutputFileName({ format: 'svg', size: { width: 'svg', height: '' } }), 'icon.svg');
  assert.strictEqual(api.getOutputFileName({ format: 'png', size: { width: 180, height: 180 } }), 'apple-touch-icon.png');
  assert.strictEqual(api.getOutputFileName({ format: 'png', size: { width: 512, height: 512 } }), 'icon-512.png');
  api.setState({ activePresetKey: 'extension' });
  assert.strictEqual(api.getOutputFileName({ format: 'png', size: { width: 128, height: 128 } }), 'extension/icons/icon128.png');
  api.setState({ activePresetKey: 'windows' });
  assert.strictEqual(api.getOutputFileName({ format: 'png', size: { width: 310, height: 150 } }), 'windows/mstile-310x150.png');

  const generatedFiles = [
    { name: 'favicon.ico', blob: makeBlob(2, 'image/x-icon'), size: { width: 'multi', height: 'multi' }, format: 'ico' },
    { name: 'icon.svg', blob: makeBlob(3, 'image/svg+xml'), size: { width: 'svg', height: '' }, format: 'svg' },
    { name: 'apple-touch-icon.png', blob: makeBlob(), size: { width: 180, height: 180 }, format: 'png' },
    { name: 'pwa/icons/icon-192x192.png', blob: makeBlob(), size: { width: 192, height: 192 }, format: 'png', purpose: 'any' },
    { name: 'pwa/icons/icon-maskable-512x512.png', blob: makeBlob(), size: { width: 512, height: 512 }, format: 'png', purpose: 'maskable' },
    { name: 'pwa/splash/apple-splash-iphone-se-640x1136.png', blob: makeBlob(), size: { width: 640, height: 1136 }, format: 'png', role: 'splash' }
  ];
  api.setState({
    sourceFileName: 'Acme App',
    activePresetKey: 'pwa',
    generatedFiles,
    generatedSnippets: {},
    replacementTargetNames: [],
    backgroundColor: '#123456'
  });
  const manifest = JSON.parse(api.buildManifestSnippet());
  assert.strictEqual(manifest.name, 'Acme-App');
  assert.strictEqual(manifest.theme_color, '#123456');
  assert(manifest.icons.some((icon) => icon.src === '/pwa/icons/icon-192x192.png' && icon.purpose === 'any'));
  assert(manifest.icons.some((icon) => icon.src === '/pwa/icons/icon-maskable-512x512.png' && icon.purpose === 'maskable'));

  api.generateSnippets([], []);
  const snippets = api.getState().generatedSnippets;
  assert(snippets.html.includes('/favicon.ico'), 'HTML snippet should include ICO link');
  assert(snippets.html.includes('/pwa/manifest.webmanifest'), 'HTML snippet should point PWA exports at the PWA manifest');
  assert(snippets.html.includes('apple-touch-startup-image'), 'HTML snippet should include splash image tags');
  assert.deepStrictEqual(Array.from(api.getSupportFiles(), (file) => file.name), [
    'snippets/head.html',
    'pwa/manifest.webmanifest',
    'README.txt'
  ]);

  const pwaBundleFiles = makePwaBundleFiles();
  api.setState({
    sourceFileName: 'Acme App',
    activePresetKey: 'pwa',
    generatedFiles: pwaBundleFiles,
    generatedSnippets: {},
    replacementTargetNames: [],
    backgroundColor: '#123456'
  });
  api.generateSnippets([], []);
  const pwaValidation = api.validateGeneratedExport();
  assert.strictEqual(pwaValidation.status, 'pass');
  assert(pwaValidation.checks.some((check) => check.label === 'PWA icon files' && check.status === 'pass'));
  assert(pwaValidation.checks.some((check) => check.label === 'Manifest icon metadata' && check.status === 'pass'));

  const brokenPwaFiles = pwaBundleFiles
    .filter((file) => file.name !== 'pwa/icons/icon-maskable-72x72.png')
    .map((file) => file.name === 'pwa/icons/icon-192x192.png'
      ? { ...file, size: { width: 128, height: 128 } }
      : file);
  api.setState({
    sourceFileName: 'Acme App',
    activePresetKey: 'pwa',
    generatedFiles: brokenPwaFiles,
    generatedSnippets: {},
    replacementTargetNames: [],
    backgroundColor: '#123456'
  });
  api.generateSnippets([], []);
  const brokenValidation = api.validateGeneratedExport();
  assert.strictEqual(brokenValidation.status, 'fail');
  assert(brokenValidation.checks.some((check) => check.detail.includes('Missing: pwa/icons/icon-maskable-72x72.png')));
  assert(brokenValidation.checks.some((check) => check.detail.includes('Wrong dimensions: pwa/icons/icon-192x192.png is 128x128, expected 192x192')));

  api.setState({
    activePresetKey: 'extension',
    generatedFiles: [
      { name: 'extension/icons/icon16.png', blob: makeBlob(), size: { width: 16, height: 16 }, format: 'png' },
      { name: 'extension/icons/icon32.png', blob: makeBlob(), size: { width: 32, height: 32 }, format: 'png' },
      { name: 'extension/icons/icon48.png', blob: makeBlob(), size: { width: 48, height: 48 }, format: 'png' },
      { name: 'extension/icons/icon128.png', blob: makeBlob(), size: { width: 128, height: 128 }, format: 'png' }
    ]
  });
  assert.strictEqual(JSON.parse(api.buildExtensionSnippet()).icons['128'], 'icons/icon128.png');

  api.setState({ activePresetKey: 'android' });
  assert(api.buildAndroidSnippet().includes('<adaptive-icon'), 'Android snippet should include adaptive icon XML');
  api.setState({ activePresetKey: 'ios' });
  assert(JSON.parse(api.buildIosContents()).images.some((image) => image.filename === 'Icon-App-1024x1024-1x.png'));
  api.setState({ activePresetKey: 'windows', backgroundColor: '#abcdef' });
  assert(api.buildWindowsBrowserConfig().includes('<TileColor>#abcdef</TileColor>'));

  api.setState({
    activePresetKey: 'pwa',
    generatedFiles,
    replacementTargetNames: ['pwa/icons/icon-192x192.png', 'apple-touch-icon.png'],
    generatedSnippets: snippets
  });
  assert(api.matchesReplacementTarget(generatedFiles[3]), 'replacement matching should accept full generated paths');
  assert(api.matchesReplacementTarget(generatedFiles[2]), 'replacement matching should accept basenames');
  const exportNames = Array.from(api.getExportFiles(), (file) => file.name);
  assert(exportNames.includes('pwa/icons/icon-192x192.png'));
  assert(exportNames.includes('apple-touch-icon.png'));
  assert(!exportNames.includes('favicon.ico'));
  assert(exportNames.includes('snippets/head.html'));

  console.log('export regression tests ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
