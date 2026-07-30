const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const scriptSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const versionSource = fs.readFileSync(path.join(root, 'version.js'), 'utf8');
const declaredVersion = versionSource.match(/ICONFORGE_VERSION\s*=\s*'([^']+)'/)[1];

class URLMock extends URL {
  static createObjectURL() {
    return 'blob:iconforge-test';
  }

  static revokeObjectURL() {}
}

class WorkerMock {
  constructor(url) {
    this.url = url;
    this.terminated = false;
    this.throwOnPost = false;
    this.lastMessage = null;
    WorkerMock.instances.push(this);
  }

  postMessage(message) {
    if (this.throwOnPost) throw new Error('transfer failed');
    this.lastMessage = message;
  }

  terminate() {
    this.terminated = true;
  }
}
WorkerMock.instances = [];

function fileSystemError(name, message) {
  const error = new Error(message);
  error.name = name;
  return error;
}

class FileHandleMock {
  constructor(root, path) {
    this.root = root;
    this.path = path;
    this.blob = null;
  }

  async createWritable() {
    const handle = this;
    return {
      async write(blob) {
        if (handle.root.failWritePath === handle.path) throw new Error(`synthetic write failure: ${handle.path}`);
        handle.blob = blob;
      },
      async close() {},
      async abort() {
        handle.blob = null;
      }
    };
  }
}

class DirectoryHandleMock {
  constructor(name = '', root = null, path = '') {
    this.name = name;
    this.root = root || this;
    this.path = path;
    this.entries = new Map();
    if (!root) {
      this.failWritePath = '';
      this.failRemove = false;
    }
  }

  childPath(name) {
    return this.path ? `${this.path}/${name}` : name;
  }

  async getDirectoryHandle(name, options = {}) {
    const entry = this.entries.get(name);
    if (entry) {
      if (!(entry instanceof DirectoryHandleMock)) throw fileSystemError('TypeMismatchError', `${name} is a file`);
      return entry;
    }
    if (!options.create) throw fileSystemError('NotFoundError', `${name} does not exist`);
    const directory = new DirectoryHandleMock(name, this.root, this.childPath(name));
    this.entries.set(name, directory);
    return directory;
  }

  async getFileHandle(name, options = {}) {
    const entry = this.entries.get(name);
    if (entry) {
      if (!(entry instanceof FileHandleMock)) throw fileSystemError('TypeMismatchError', `${name} is a directory`);
      return entry;
    }
    if (!options.create) throw fileSystemError('NotFoundError', `${name} does not exist`);
    const file = new FileHandleMock(this.root, this.childPath(name));
    this.entries.set(name, file);
    return file;
  }

  async removeEntry(name) {
    if (this.root.failRemove) throw new Error('synthetic rollback failure');
    if (!this.entries.has(name)) throw fileSystemError('NotFoundError', `${name} does not exist`);
    this.entries.delete(name);
  }
}

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
    lossyQualitySlider: '92',
    lossyQualityValue: '92%',
    sizeBudgetInput: '',
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
    manifestName: '',
    manifestShortName: '',
    manifestId: '',
    manifestDescription: '',
    manifestStartUrl: './index.html',
    manifestScope: './',
    manifestDisplay: 'standalone',
    manifestCategories: '',
    manifestThemeColor: '#09090b',
    manifestBackgroundColor: '#09090b',
    manifestLang: 'en',
    manifestDir: 'auto',
    manifestMonochrome: '',
    manifestShortcuts: '',
    manifestScreenshots: '',
    manifestLocalized: '',
    assetUrlMode: 'root',
    assetUrlBase: '/assets/',
    cacheBustToggle: '',
    toleranceSlider: '10',
    toleranceValue: '10'
  };

  function elementFor(id) {
    if (!elements.has(id)) {
      const el = new ElementMock(id.toLowerCase().includes('canvas') ? 'canvas' : 'div', id);
      if (Object.prototype.hasOwnProperty.call(defaults, id)) el.value = defaults[id];
      if (id === 'dropShadowToggle') el.checked = false;
      if (id === 'cacheBustToggle') el.checked = false;
      if (id === 'manifestMonochrome') {
        el.type = 'checkbox';
        el.checked = false;
      }
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
  const localStorageData = new Map();
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
    Date,
    Math,
    JSON,
    Promise,
    AbortController,
    Error,
    Set,
    Map,
    Object,
    Array,
    parseInt,
    document,
    localStorage: {
      getItem(key) {
        return localStorageData.has(key) ? localStorageData.get(key) : null;
      },
      setItem(key, value) {
        localStorageData.set(key, String(value));
      },
      removeItem(key) {
        localStorageData.delete(key);
      }
    },
    crypto: crypto.webcrypto,
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
    URL: URLMock,
    Worker: WorkerMock,
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
    DOMParser: class {
      parseFromString(text) {
        const trimmed = String(text || '').trim();
        return {
          documentElement: { localName: /^<svg[\s>]/i.test(trimmed) ? 'svg' : 'html' },
          querySelector(selector) {
            if (selector === 'parsererror' && /<svg\b[^>]*>\s*<path\b[^/>]*>\s*<\/svg>/i.test(trimmed)) return {};
            return null;
          }
        };
      }
    },
    FileReader: class {},
    setTimeout,
    clearTimeout,
    ICONFORGE_VERSION: declaredVersion,
    __ICONFORGE_ENABLE_TEST_API__: true
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(scriptSource, context, { filename: 'app.js' });
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
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const localName = decoder.decode(bytes.slice(localOffset + 30, localOffset + 30 + localNameLength));
    assert.strictEqual(localName, name, `${name} local header filename mismatch`);
    assert.strictEqual(localExtraLength, 0, `${name} local header should not include extra fields`);
    assert(localOffset + 30 + localNameLength + compressedSize <= bytes.length, `${name} local payload should stay inside ZIP`);
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
    { width: 2048, height: 2732, name: 'ipad-pro-12-9' },
    { width: 1668, height: 2388, name: 'ipad-pro-11' },
    { width: 1536, height: 2048, name: 'ipad-9-7' },
    { width: 1640, height: 2360, name: 'ipad-air-11' },
    { width: 1668, height: 2224, name: 'ipad-air-10-5' },
    { width: 1620, height: 2160, name: 'ipad-10-2' },
    { width: 1488, height: 2266, name: 'ipad-mini-8-3' },
    { width: 1320, height: 2868, name: 'iphone-16-pro-max' },
    { width: 1206, height: 2622, name: 'iphone-16-pro' },
    { width: 1260, height: 2736, name: 'iphone-air' },
    { width: 1290, height: 2796, name: 'iphone-16-plus' },
    { width: 1179, height: 2556, name: 'iphone-16' },
    { width: 1170, height: 2532, name: 'iphone-16e' },
    { width: 1284, height: 2778, name: 'iphone-14-plus' },
    { width: 1125, height: 2436, name: 'iphone-13-mini' },
    { width: 1242, height: 2688, name: 'iphone-11-pro-max' },
    { width: 828, height: 1792, name: 'iphone-11' },
    { width: 1242, height: 2208, name: 'iphone-8-plus' },
    { width: 750, height: 1334, name: 'iphone-8' },
    { width: 640, height: 1136, name: 'iphone-se-4' }
  ];
  const scaleTwoNames = new Set([
    'ipad-pro-12-9', 'ipad-pro-11', 'ipad-9-7', 'ipad-air-11', 'ipad-air-10-5',
    'ipad-10-2', 'ipad-mini-8-3', 'iphone-11', 'iphone-8', 'iphone-se-4'
  ]);
  const enrichedSplashSpecs = splashSpecs.map((splash) => {
    const scaleFactor = scaleTwoNames.has(splash.name) ? 2 : 3;
    return {
      ...splash,
      cssWidth: splash.width / scaleFactor,
      cssHeight: splash.height / scaleFactor,
      scaleFactor
    };
  });
  return [
    ...iconSizes.flatMap((px) => [
      { name: `pwa/icons/icon-${px}x${px}.png`, blob: makeBlob(), size: { width: px, height: px }, format: 'png', purpose: 'any' },
      {
        name: `pwa/icons/icon-maskable-${px}x${px}.png`,
        blob: makeBlob(),
        size: { width: px, height: px },
        format: 'png',
        purpose: 'maskable',
        safeZoneRadiusRatio: 0.4,
        safeZonePaddingPercent: 22,
        safeZoneBackgroundColor: '#123456'
      }
    ]),
    ...enrichedSplashSpecs.flatMap((splash) => [
      {
        name: `pwa/splash/apple-splash-${splash.name}-${splash.width}x${splash.height}.png`,
        blob: makeBlob(),
        size: { width: splash.width, height: splash.height },
        format: 'png',
        role: 'splash',
        splashSpec: { ...splash, orientation: 'portrait' }
      },
      {
        name: `pwa/splash/apple-splash-${splash.name}-${splash.height}x${splash.width}.png`,
        blob: makeBlob(),
        size: { width: splash.height, height: splash.width },
        format: 'png',
        role: 'splash',
        splashSpec: {
          ...splash,
          cssWidth: splash.cssHeight,
          cssHeight: splash.cssWidth,
          orientation: 'landscape'
        }
      }
    ])
  ];
}

function makeAndroidDensityFiles() {
  const densities = [
    { density: 'mdpi', adaptive: 108, legacy: 48 },
    { density: 'hdpi', adaptive: 162, legacy: 72 },
    { density: 'xhdpi', adaptive: 216, legacy: 96 },
    { density: 'xxhdpi', adaptive: 324, legacy: 144 },
    { density: 'xxxhdpi', adaptive: 432, legacy: 192 }
  ];
  return densities.flatMap((spec) => [
    {
      name: `android/mipmap-${spec.density}/ic_launcher_foreground.png`,
      blob: makeBlob(),
      size: { width: spec.adaptive, height: spec.adaptive },
      format: 'png',
      role: 'android-foreground'
    },
    {
      name: `android/mipmap-${spec.density}/ic_launcher_background.png`,
      blob: makeBlob(),
      size: { width: spec.adaptive, height: spec.adaptive },
      format: 'png',
      role: 'android-background'
    },
    {
      name: `android/mipmap-${spec.density}/ic_launcher.png`,
      blob: makeBlob(),
      size: { width: spec.legacy, height: spec.legacy },
      format: 'png',
      role: 'android-legacy'
    },
    {
      name: `android/mipmap-${spec.density}/ic_launcher_round.png`,
      blob: makeBlob(),
      size: { width: spec.legacy, height: spec.legacy },
      format: 'png',
      role: 'android-round'
    },
    {
      name: `android/mipmap-${spec.density}/ic_launcher_monochrome.png`,
      blob: makeBlob(),
      size: { width: spec.adaptive, height: spec.adaptive },
      format: 'png',
      role: 'android-monochrome',
      purpose: 'monochrome'
    }
  ]);
}

async function main() {
  const api = loadApp();
  assert.strictEqual(api.APP_VERSION, declaredVersion);
  for (const metadata of Object.values(api.PLATFORM_MATRIX_METADATA)) {
    assert.match(metadata.source, /^https:\/\//);
    assert.match(metadata.lastVerified, /^\d{4}-\d{2}-\d{2}$/);
  }
  const workerState = api.getWorkerDebugState();
  assert.strictEqual(workerState.active, true, 'worker should initialize when the API is available');
  const successfulWorkerJob = api.resizeInWorker({ width: 1, height: 1 }, 32, 32, 'png', null, undefined, 50);
  const successfulWorker = api.getWorkerDebugState().worker;
  const workerBlob = makeBlob();
  successfulWorker.onmessage({ data: { id: successfulWorker.lastMessage.id, blob: workerBlob } });
  assert.strictEqual(await successfulWorkerJob, workerBlob);
  assert.strictEqual(api.getWorkerDebugState().pendingJobs, 0);

  const crashedWorkerJob = api.resizeInWorker({ width: 1, height: 1 }, 32, 32, 'png', null, undefined, 50);
  const crashedWorker = api.getWorkerDebugState().worker;
  crashedWorker.onerror({ message: 'synthetic crash', preventDefault() {} });
  await assert.rejects(crashedWorkerJob, /Resize worker crashed: synthetic crash/);
  assert.strictEqual(crashedWorker.terminated, true);
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(api.getWorkerDebugState(), (key, value) => key === 'worker' ? undefined : value)),
    { active: false, pendingJobs: 0 }
  );

  api.initWorker();
  const unreadableWorkerJob = api.resizeInWorker({ width: 1, height: 1 }, 32, 32, 'png', null, undefined, 50);
  const unreadableWorker = api.getWorkerDebugState().worker;
  unreadableWorker.onmessageerror();
  await assert.rejects(unreadableWorkerJob, /unreadable response/);
  assert.strictEqual(unreadableWorker.terminated, true);

  api.initWorker();
  await assert.rejects(
    api.resizeInWorker({ width: 1, height: 1 }, 32, 32, 'png', null, undefined, 5),
    /timed out after 5ms/
  );
  assert.strictEqual(api.getWorkerDebugState().active, false);
  assert.strictEqual(api.getWorkerDebugState().pendingJobs, 0);

  api.initWorker();
  const transferWorker = api.getWorkerDebugState().worker;
  transferWorker.throwOnPost = true;
  await assert.rejects(
    api.resizeInWorker({ width: 1, height: 1 }, 32, 32, 'png', null, undefined, 50),
    /Could not send resize job to worker: transfer failed/
  );
  assert.strictEqual(transferWorker.terminated, true);
  assert.strictEqual(api.getWorkerDebugState().pendingJobs, 0);

  await assert.rejects(
    api.canvasToOutputBlob({ toBlob() {} }, 'image/png', undefined, 'PNG 32x32', 5),
    /PNG 32x32 encoder failed: Canvas encoder timed out after 5ms/
  );
  await assert.rejects(
    api.canvasToOutputBlob({ toBlob(callback) { callback(null); } }, 'image/png', undefined, 'PNG 32x32', 50),
    /PNG 32x32 encoder did not produce a file blob/
  );

  const folderRoot = new DirectoryHandleMock();
  await folderRoot.getDirectoryHandle('IconForge-Acme-icons', { create: true });
  const folderFiles = [
    { name: 'icon.png', blob: makeBlob() },
    { name: 'snippets/head.html', blob: new Blob(['<link>'], { type: 'text/html' }) }
  ];
  const folderResult = await api.saveExportBundleToDirectory(
    folderRoot,
    folderFiles,
    'IconForge-Acme-icons'
  );
  assert.strictEqual(folderResult.directoryName, 'IconForge-Acme-icons-2');
  assert.deepStrictEqual([...folderResult.conflicts], ['IconForge-Acme-icons']);
  assert.deepStrictEqual([...folderResult.written], ['icon.png', 'snippets/head.html']);
  const savedBundle = folderRoot.entries.get('IconForge-Acme-icons-2');
  assert(savedBundle.entries.get('icon.png').blob, 'root export file should be committed');
  assert(savedBundle.entries.get('snippets').entries.get('head.html').blob, 'nested export file should be committed');

  const rollbackRoot = new DirectoryHandleMock();
  rollbackRoot.failWritePath = 'IconForge-Rollback-icons/snippets/head.html';
  await assert.rejects(
    api.saveExportBundleToDirectory(rollbackRoot, folderFiles, 'IconForge-Rollback-icons'),
    (error) => {
      assert.match(error.message, /incomplete folder "IconForge-Rollback-icons" was removed/);
      assert.strictEqual(error.exportResult.rolledBack, true);
      assert.deepStrictEqual([...error.exportResult.written], ['icon.png']);
      return true;
    }
  );
  assert.strictEqual(rollbackRoot.entries.has('IconForge-Rollback-icons'), false);

  const partialRoot = new DirectoryHandleMock();
  partialRoot.failWritePath = 'IconForge-Partial-icons/snippets/head.html';
  partialRoot.failRemove = true;
  await assert.rejects(
    api.saveExportBundleToDirectory(partialRoot, folderFiles, 'IconForge-Partial-icons'),
    (error) => {
      assert.match(error.message, /Files written: icon\.png/);
      assert.match(error.message, /Remove that folder before retrying/);
      assert.strictEqual(error.exportResult.rolledBack, false);
      return true;
    }
  );
  assert.strictEqual(partialRoot.entries.has('IconForge-Partial-icons'), true);

  const cancelledWrite = new AbortController();
  cancelledWrite.abort();
  await assert.rejects(
    api.writeFileToDirectory(new DirectoryHandleMock(), 'icon.png', makeBlob(), cancelledWrite.signal),
    (error) => error.name === 'AbortError'
  );
  assert.strictEqual(api.uiText('shell.draftRecovery'), 'Draft Recovery');
  assert.strictEqual(api.uiText('diagnostics.metrics.workerFallback'), 'Worker fallback state');
  assert.strictEqual(api.uiText('status.launchedFileOpened', { name: 'logo.png' }), 'Opened logo.png from the operating system.');
  assert.strictEqual(api.uiText('snippets.androidMissing'), 'Run the Android preset to generate adaptive icon PNGs and ic_launcher.xml handoff files.');
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(api.inspectSourceFile({ name: 'icon.png', type: 'image/png', size: 1024 }))),
    { valid: true, code: 'SOURCE_ACCEPTED', message: '', warning: '' }
  );
  assert.strictEqual(api.inspectSourceFile({ name: 'notes.txt', type: 'text/plain', size: 10 }).code, 'SOURCE_TYPE_INVALID');
  assert.strictEqual(api.inspectSourceFile({ name: 'huge.png', type: 'image/png', size: 201 * 1024 * 1024 }).code, 'SOURCE_TOO_LARGE');
  assert.match(api.inspectSourceFile({ name: 'large.png', type: 'image/png', size: 51 * 1024 * 1024 }).warning, /processing may be slow/);
  assert.throws(() => api.uiText('missing.catalog.key'), /Missing UI string/);
  const catalogValues = new Set();
  const collectCatalogValues = (value) => {
    if (typeof value === 'string') catalogValues.add(value);
    else if (Array.isArray(value)) value.forEach(collectCatalogValues);
    else if (value && typeof value === 'object') Object.values(value).forEach(collectCatalogValues);
  };
  collectCatalogValues(api.UI_STRINGS);
  const decodeHtml = (value) => value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&middot;/g, '·')
    .replace(/&times;/g, '×')
    .replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (_, hex, decimal) => String.fromCodePoint(parseInt(hex || decimal, hex ? 16 : 10)));
  const shellWithoutComments = htmlSource.replace(/<!--[\s\S]*?-->/g, '');
  const visibleLiterals = Array.from(shellWithoutComments.matchAll(/>([^<]+)</g), (match) => decodeHtml(match[1]).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((value) => !/^(?:\d+%?|\d+x\d+)$/.test(value));
  const attributeLiterals = Array.from(
    shellWithoutComments.matchAll(/\b(?:aria-label|placeholder|title|alt)=(["'])(.*?)\1/gi),
    (match) => decodeHtml(match[2]).trim()
  ).filter((value) => value && !/^(?:A|256)$/.test(value));
  const uncatalogedLiterals = [...new Set([...visibleLiterals, ...attributeLiterals])]
    .filter((value) => !catalogValues.has(value));
  assert.deepStrictEqual(uncatalogedLiterals, [], `uncataloged UI literals: ${uncatalogedLiterals.join(' | ')}`);
  const catalogHookKeys = Array.from(htmlSource.matchAll(/\bdata-i18n(?:-title|-aria-label)?=["']([^"']+)["']/gi), (match) => match[1]);
  catalogHookKeys.forEach((key) => assert.strictEqual(typeof api.getUiString(key), 'string', `missing UI catalog key: ${key}`));
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(api.inspectAssetBase('https://cdn.example.com/assets'))),
    { valid: true, normalized: 'https://cdn.example.com/assets/', error: '' }
  );
  assert.strictEqual(api.inspectAssetBase('./assets').normalized, './assets/');
  assert.strictEqual(api.inspectAssetBase('/assets').normalized, '/assets/');
  const pngHeader = new Uint8Array(24);
  pngHeader.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  pngHeader.set([73, 72, 68, 82], 12);
  new DataView(pngHeader.buffer).setUint32(16, 192, false);
  new DataView(pngHeader.buffer).setUint32(20, 192, false);
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(api.inspectArtifactBytes({ format: 'png' }, pngHeader))),
    { valid: true, width: 192, height: 192, icoSizes: [], error: '' }
  );
  assert.strictEqual(api.inspectArtifactBytes({ format: 'png' }, new Uint8Array([1, 2, 3])).valid, false);
  const iphone16ProMax = api.PWA_SPLASH_SPECS.find((spec) => spec.name === 'iphone-16-pro-max');
  assert.strictEqual(iphone16ProMax.cssWidth, 440);
  assert.strictEqual(iphone16ProMax.cssHeight, 956);
  assert.strictEqual(iphone16ProMax.scaleFactor, 3);
  assert.strictEqual(iphone16ProMax.lastVerified, '2026-07-25');
  [
    '',
    'javascript:alert(1)',
    'data:text/html,unsafe',
    '//cdn.example.com/assets',
    'https://user:secret@cdn.example.com/assets',
    'https://cdn.example.com/assets?version=1',
    'https://cdn.example.com/\"><script>alert(1)</script>',
    'assets\\icons',
    'assets/%zz'
  ].forEach((base) => {
    assert.strictEqual(api.inspectAssetBase(base).valid, false, `asset base should be rejected: ${base}`);
  });
  const appManifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  assert.strictEqual(appManifest.scope, './');
  assert.strictEqual(appManifest.launch_handler.client_mode, 'focus-existing');
  assert(appManifest.icons.some((icon) => icon.sizes === '192x192' && icon.type === 'image/png' && icon.purpose === 'any'));
  assert(appManifest.icons.some((icon) => icon.sizes === '512x512' && icon.type === 'image/png' && icon.purpose === 'any'));
  assert(appManifest.icons.some((icon) => icon.sizes === '512x512' && icon.type === 'image/png' && icon.purpose === 'maskable'));
  assert.strictEqual(appManifest.theme_color, '#07090f');
  assert.strictEqual(appManifest.background_color, '#07090f');
  assert(appManifest.file_handlers.some((handler) => handler.action === './index.html' && handler.accept['image/png'].includes('.png')));
  assert(appManifest.file_handlers.some((handler) => handler.accept['image/svg+xml'].includes('.svg')));
  assert(appManifest.file_handlers.some((handler) => handler.accept['image/x-icon'].includes('.ico')));

  const zipBlob = api.buildZip([
    { name: 'pwa/icons/icon-192x192.png', data: new Uint8Array([1, 2, 3]) },
    { name: 'snippets/head.html', data: new TextEncoder().encode('<link rel="manifest">') }
  ]);
  assert.deepStrictEqual(readZipCentralDirectory(await blobBytes(zipBlob)), [
    'pwa/icons/icon-192x192.png',
    'snippets/head.html'
  ]);
  assert.deepStrictEqual(
    [...await api.readZipFileNames(zipBlob)],
    ['pwa/icons/icon-192x192.png', 'snippets/head.html']
  );

  const blobZipResult = await api.buildZipFromBlobs([
    { name: 'icons/icon-界.png', blob: new Blob([new Uint8Array([4, 5, 6])], { type: 'image/png' }) },
    { name: 'README.txt', blob: new Blob(['local export']) }
  ]);
  assert.deepStrictEqual(readZipCentralDirectory(await blobBytes(blobZipResult.blob)), [
    'icons/icon-界.png',
    'README.txt'
  ]);
  assert.strictEqual(blobZipResult.plan.entryCount, 2);
  assert(blobZipResult.plan.estimatedPeakWorkingBytes >= blobZipResult.plan.archiveBytes);

  const zipLimitOverhead = 30 + 1 + 46 + 1 + 22;
  const nearZip32Plan = api.inspectZipPlan(
    [{ name: 'a', blob: { size: api.ZIP32_MAX - zipLimitOverhead } }],
    { maxWorkingBytes: Infinity }
  );
  assert.strictEqual(nearZip32Plan.archiveBytes, api.ZIP32_MAX);
  assert.throws(
    () => api.inspectZipPlan(
      [{ name: 'a', blob: { size: api.ZIP32_MAX - zipLimitOverhead + 1 } }],
      { maxWorkingBytes: Infinity }
    ),
    (error) => error.code === 'ZIP_ARCHIVE_SIZE_LIMIT'
  );
  assert.throws(
    () => api.inspectZipPlan([{ name: 'too-large.bin', blob: { size: api.ZIP32_MAX + 1 } }], { maxWorkingBytes: Infinity }),
    (error) => error.code === 'ZIP_FILE_SIZE_LIMIT'
  );
  assert.throws(
    () => api.inspectZipPlan([{ name: 'budget.bin', blob: { size: 1024 } }], { maxWorkingBytes: 1024 }),
    (error) => error.code === 'ZIP_MEMORY_BUDGET' && /Save to Folder/.test(error.message)
  );

  const generatedSentinel = [{ name: 'kept.png', blob: new Blob([new Uint8Array([9])]) }];
  api.setState({ generatedFiles: generatedSentinel });
  const zipAbort = new AbortController();
  await assert.rejects(
    api.buildZipFromBlobs(
      [{ name: 'cancel.bin', blob: new Blob([new Uint8Array(2 * 1024 * 1024)]) }],
      {
        signal: zipAbort.signal,
        onProgress() {
          zipAbort.abort();
        }
      }
    ),
    (error) => error.name === 'AbortError'
  );
  assert.strictEqual(api.getState().generatedFiles[0].name, 'kept.png', 'cancelled ZIP work must retain generated files');

  const pwaGenerationPlan = api.inspectGenerationPlan({
    sizes: [72, 96, 128, 144, 152, 192, 384, 512].map((size) => ({ width: size, height: size })),
    formats: ['png'],
    presetKey: 'pwa',
    sourceWidth: 1024,
    sourceHeight: 1024,
    monochrome: false
  });
  assert.strictEqual(pwaGenerationPlan.allowed, true);
  assert.strictEqual(pwaGenerationPlan.operationCount, 66);
  assert(pwaGenerationPlan.estimatedPeakWorkingBytes > 0);
  assert.strictEqual(
    api.inspectGenerationPlan({
      sizes: [{ width: 4096, height: 4096 }],
      formats: ['png'],
      presetKey: null,
      maxOperations: 2
    }).allowed,
    false,
    'operation preflight should reject work above its operation limit'
  );
  const memoryBlockedPlan = api.inspectGenerationPlan({
    sizes: [{ width: 4096, height: 4096 }],
    formats: ['png'],
    presetKey: null,
    maxWorkingBytes: 1024
  });
  assert.strictEqual(memoryBlockedPlan.allowed, false);
  assert.match(memoryBlockedPlan.reason, /memory safety budget/);

  let oversizedZipRead = false;
  await assert.rejects(
    api.readZipFileNames({
      size: api.REPLACEMENT_ZIP_LIMITS.maxBytes + 1,
      async arrayBuffer() {
        oversizedZipRead = true;
        return new ArrayBuffer(0);
      }
    }),
    /64 MB limit/
  );
  assert.strictEqual(oversizedZipRead, false, 'oversized ZIP should be rejected before reading bytes');

  const excessiveEntries = new Uint8Array(22);
  const excessiveEntriesView = new DataView(excessiveEntries.buffer);
  excessiveEntriesView.setUint32(0, 0x06054b50, true);
  excessiveEntriesView.setUint16(8, api.REPLACEMENT_ZIP_LIMITS.maxEntries + 1, true);
  excessiveEntriesView.setUint16(10, api.REPLACEMENT_ZIP_LIMITS.maxEntries + 1, true);
  await assert.rejects(
    api.readZipFileNames(new Blob([excessiveEntries])),
    /10000-entry limit/
  );

  const oversizedDirectory = excessiveEntries.slice();
  const oversizedDirectoryView = new DataView(oversizedDirectory.buffer);
  oversizedDirectoryView.setUint16(8, 0, true);
  oversizedDirectoryView.setUint16(10, 0, true);
  oversizedDirectoryView.setUint32(12, api.REPLACEMENT_ZIP_LIMITS.maxCentralDirectoryBytes + 1, true);
  await assert.rejects(
    api.readZipFileNames(new Blob([oversizedDirectory])),
    /central directory exceeds the 16 MB limit/
  );

  const malformedZipBytes = await blobBytes(api.buildZip([
    { name: 'safe.png', data: new Uint8Array([1, 2, 3]) }
  ]));
  const malformedZipView = new DataView(
    malformedZipBytes.buffer,
    malformedZipBytes.byteOffset,
    malformedZipBytes.byteLength
  );
  let centralOffset = -1;
  for (let index = 0; index <= malformedZipBytes.length - 4; index++) {
    if (malformedZipView.getUint32(index, true) === 0x02014b50) {
      centralOffset = index;
      break;
    }
  }
  assert(centralOffset >= 0, 'test ZIP should contain a central directory');

  const longNameZip = malformedZipBytes.slice();
  new DataView(longNameZip.buffer).setUint16(centralOffset + 28, api.REPLACEMENT_ZIP_LIMITS.maxNameBytes + 1, true);
  await assert.rejects(api.readZipFileNames(new Blob([longNameZip])), /1024-byte limit/);

  const badSignatureZip = malformedZipBytes.slice();
  badSignatureZip[centralOffset] = 0;
  await assert.rejects(api.readZipFileNames(new Blob([badSignatureZip])), /invalid signature/);

  const invalidUtf8Zip = malformedZipBytes.slice();
  invalidUtf8Zip[centralOffset + 46] = 0xff;
  await assert.rejects(api.readZipFileNames(new Blob([invalidUtf8Zip])), /not valid UTF-8/);

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

  assert.doesNotThrow(() => api.validateSvgSourceText('<svg viewBox="0 0 1 1"></svg>', 'valid.svg'));
  assert.throws(
    () => api.validateSvgSourceText('<svg><path></svg>', 'broken.svg'),
    /malformed SVG/,
    'Malformed SVG input should fail before image decoding'
  );
  assert.throws(
    () => api.validateSvgSourceText('<svg><image href="https://example.com/icon.png"/></svg>', 'remote.svg'),
    /external references/,
    'Remote SVG references should be rejected before canvas export'
  );
  assert.throws(
    () => api.validateSvgSourceText('<svg><script>alert(1)</script></svg>', 'script.svg'),
    /active SVG content/,
    'Active SVG content should not enter the canvas path'
  );

  api.setState({ generatedFiles: [] });
  assert.throws(
    () => api.addGeneratedFile('missing.png', null, { width: 16, height: 16 }, 'png'),
    /did not produce a file blob/,
    'Missing blobs should not be registered as generated files'
  );
  assert.throws(
    () => api.addGeneratedFile('empty.png', new Blob([], { type: 'image/png' }), { width: 16, height: 16 }, 'png'),
    /produced an empty file/,
    'Empty blobs should not be registered as generated files'
  );
  assert.strictEqual(api.getState().generatedFiles.length, 0, 'Rejected blob registrations must not mutate generated files');
  api.addGeneratedFile('safe.png', makeBlob(1, 'image/png'), { width: 16, height: 16 }, 'png');
  assert.strictEqual(api.getState().generatedFiles.length, 1, 'Valid blobs should still register normally');

  api.setState({ sourceFileName: 'Acme Brand', activePresetKey: 'web' });
  assert.strictEqual(api.getOutputFileName({ format: 'ico', size: { width: 'multi', height: 'multi' } }), 'favicon.ico');
  assert.strictEqual(api.getOutputFileName({ format: 'svg', size: { width: 'svg', height: '' } }), 'icon.svg');
  assert.strictEqual(api.getOutputFileName({ format: 'png', size: { width: 180, height: 180 } }), 'apple-touch-icon.png');
  assert.strictEqual(api.getOutputFileName({ format: 'png', size: { width: 512, height: 512 } }), 'icon-512.png');
  assert.strictEqual(api.outputGroupKey('pwa/icons/icon-192x192.png'), 'pwa-icons');
  assert.strictEqual(api.outputGroupKey('pwa/splash/apple-splash-640x1136.png'), 'pwa-splash');
  assert.strictEqual(api.outputGroupKey('android/mipmap-hdpi/ic_launcher.png'), 'android');
  assert.strictEqual(api.outputGroupKey('ios/AppIcon.appiconset/Icon-App-60x60-3x.png'), 'ios');
  assert.strictEqual(api.outputGroupKey('icon-512.png'), 'core');
  api.setState({ activePresetKey: 'extension' });
  assert.strictEqual(api.getOutputFileName({ format: 'png', size: { width: 128, height: 128 } }), 'extension/icons/icon128.png');
  api.setState({ activePresetKey: 'windows' });
  assert.strictEqual(api.getOutputFileName({ format: 'png', size: { width: 310, height: 150 } }), 'windows/mstile-310x150.png');
  api.setState({ activePresetKey: 'social' });
  assert.strictEqual(api.getOutputFileName({ format: 'png', size: { width: 1200, height: 630 } }), 'social/og-image.png');
  assert.strictEqual(api.getOutputFileName({ format: 'png', size: { width: 1200, height: 675 } }), 'social/twitter-card.png');

  const generatedFiles = [
    { name: 'favicon.ico', blob: makeBlob(2, 'image/x-icon'), size: { width: 'multi', height: 'multi' }, format: 'ico' },
    { name: 'icon.svg', blob: makeBlob(3, 'image/svg+xml'), size: { width: 'svg', height: '' }, format: 'svg' },
    { name: 'apple-touch-icon.png', blob: makeBlob(), size: { width: 180, height: 180 }, format: 'png' },
    { name: 'pwa/icons/icon-192x192.png', blob: makeBlob(), size: { width: 192, height: 192 }, format: 'png', purpose: 'any' },
    { name: 'pwa/icons/icon-maskable-512x512.png', blob: makeBlob(), size: { width: 512, height: 512 }, format: 'png', purpose: 'maskable' },
    { name: 'pwa/icons/icon-monochrome-512x512.png', blob: makeBlob(), size: { width: 512, height: 512 }, format: 'png', purpose: 'monochrome' },
    { name: 'pwa/splash/apple-splash-iphone-se-640x1136.png', blob: makeBlob(), size: { width: 640, height: 1136 }, format: 'png', role: 'splash' }
  ];
  api.setState({
    sourceFileName: 'Acme App',
    activePresetKey: 'pwa',
    generatedFiles,
    generatedSnippets: {},
    replacementTargetNames: [],
    backgroundColor: '#123456',
    manifestMetadata: {
      themeColor: '#123456',
      backgroundColor: '#123456'
    }
  });
  const manifest = JSON.parse(api.buildManifestSnippet());
  assert.strictEqual(manifest.name, 'Acme-App');
  assert.strictEqual(manifest.short_name, 'Acme-App');
  assert.strictEqual(manifest.description, 'Generated icon set for Acme-App.');
  assert.strictEqual(manifest.start_url, './index.html');
  assert.strictEqual(manifest.scope, './');
  assert.strictEqual(manifest.display, 'standalone');
  assert.strictEqual(manifest.theme_color, '#123456');
  assert.strictEqual(manifest.background_color, '#123456');
  assert.strictEqual(manifest.lang, 'en');
  assert.strictEqual(manifest.dir, 'auto');
  assert(!Object.prototype.hasOwnProperty.call(manifest, 'id'), 'empty id should be omitted');
  assert(!Object.prototype.hasOwnProperty.call(manifest, 'categories'), 'empty categories should be omitted');
  assert(!Object.prototype.hasOwnProperty.call(manifest, 'shortcuts'), 'empty shortcuts should be omitted');
  assert(manifest.icons.some((icon) => icon.src === '/pwa/icons/icon-192x192.png' && icon.purpose === 'any'));
  assert(manifest.icons.some((icon) => icon.src === '/pwa/icons/icon-maskable-512x512.png' && icon.purpose === 'maskable'));
  assert(!manifest.icons.some((icon) => icon.purpose === 'monochrome'), 'monochrome icon entry should be omitted by default');

  const svgFavicon = api.generateSvgFavicon(new ElementMock('img'), null);
  assert(svgFavicon.includes('<style>'), 'SVG favicon should embed its style block');
  assert(svgFavicon.includes('@media (prefers-color-scheme: dark)'), 'SVG favicon should include dark-mode media CSS');
  assert(svgFavicon.includes('.iconforge-bg { fill: #111111; }'), 'SVG favicon should use selected light color');
  assert(svgFavicon.includes('.iconforge-bg { fill: #ffffff; }'), 'SVG favicon should use selected dark color');
  assert(svgFavicon.includes('data:image/png;base64,AA=='), 'SVG favicon should embed the generated raster layer');
  assert(!svgFavicon.includes('<link'), 'SVG favicon should not link external stylesheets');
  assert(!svgFavicon.includes('styles.css'), 'SVG favicon should be self-contained');

  api.setState({
    manifestMetadata: {
      name: 'Acme Operations Console',
      shortName: 'Acme Ops',
      id: './dashboard/',
      description: 'Local deployment assets for Acme operations.',
      startUrl: './dashboard/',
      scope: './',
      display: 'minimal-ui',
      categories: 'business, utilities, productivity',
      themeColor: '#112233',
      backgroundColor: '#445566',
      lang: 'ar',
      dir: 'rtl',
      monochrome: true,
      shortcuts: [{ name: 'Reports', short_name: 'Reports', url: './reports/' }],
      screenshots: [{ src: '/screenshots/home.png', sizes: '1280x720', type: 'image/png' }],
      localized: {
        name_localized: {
          fr: 'Console des opérations Acme',
          'pt-br': { value: 'Console de operações Acme', lang: 'pt-br', dir: 'LTR' }
        },
        short_name_localized: {
          ar: { value: 'عمليات أكمي', dir: 'rtl' }
        }
      }
    }
  });
  const editedManifest = JSON.parse(api.buildManifestSnippet());
  assert.strictEqual(editedManifest.name, 'Acme Operations Console');
  assert.strictEqual(editedManifest.short_name, 'Acme Ops');
  assert.strictEqual(editedManifest.id, './dashboard/');
  assert.strictEqual(editedManifest.description, 'Local deployment assets for Acme operations.');
  assert.strictEqual(editedManifest.start_url, './dashboard/');
  assert.strictEqual(editedManifest.display, 'minimal-ui');
  assert.deepStrictEqual(editedManifest.categories, ['business', 'utilities', 'productivity']);
  assert.strictEqual(editedManifest.theme_color, '#112233');
  assert.strictEqual(editedManifest.background_color, '#445566');
  assert.strictEqual(editedManifest.lang, 'ar');
  assert.strictEqual(editedManifest.dir, 'rtl');
  assert(editedManifest.icons.some((icon) => icon.src === '/pwa/icons/icon-monochrome-512x512.png' && icon.purpose === 'monochrome' && icon.type === 'image/png'));
  assert.strictEqual(editedManifest.shortcuts[0].url, './reports/');
  assert.strictEqual(editedManifest.screenshots[0].sizes, '1280x720');
  assert.strictEqual(editedManifest.name_localized.fr, 'Console des opérations Acme');
  assert.deepStrictEqual(
    editedManifest.name_localized['pt-BR'],
    { value: 'Console de operações Acme', lang: 'pt-BR', dir: 'ltr' }
  );
  assert.deepStrictEqual(editedManifest.short_name_localized.ar, { value: 'عمليات أكمي', dir: 'rtl' });

  api.setState({ manifestMetadata: { lang: '', dir: '', shortcuts: '{broken', screenshots: 'not-an-array', localized: '{broken' } });
  const invalidMetadata = api.validateManifestMetadata();
  assert(invalidMetadata.errors.includes('Shortcuts must be valid JSON.'));
  assert(invalidMetadata.errors.includes('Screenshots must be valid JSON.'));
  assert(invalidMetadata.errors.includes('Localized fields must be valid JSON.'));
  assert.strictEqual(api.buildManifestSnippet(), '', 'invalid metadata should fail closed instead of emitting a partial manifest');
  api.setState({
    manifestMetadata: {
      lang: 'not_a_language',
      startUrl: 'javascript:alert(1)',
      scope: './app/',
      id: 'https://other.example/app',
      shortcuts: [{ name: 'Admin', url: '../admin/' }],
      screenshots: [{ src: 'data:text/html,unsafe', sizes: 'wide', type: 'text/html' }],
      localized: {
        name_localized: {
          bad_tag: 'Unsafe',
          fr: { value: 'Nom', dir: 'sideways' }
        },
        icons_localized: { en: 'Not supported' }
      }
    }
  });
  const unsafeMetadata = api.validateManifestMetadata();
  assert(unsafeMetadata.errors.some((error) => error.includes('BCP 47')));
  assert(unsafeMetadata.errors.some((error) => error.includes('Start URL must be a safe')));
  assert(unsafeMetadata.errors.some((error) => error.includes('ID must be a safe')));
  assert(unsafeMetadata.errors.some((error) => error.includes('Shortcut 1 URL must stay within')));
  assert(unsafeMetadata.errors.some((error) => error.includes('Screenshot 1 src must use')));
  assert(unsafeMetadata.errors.some((error) => error.includes('Screenshot 1 sizes')));
  assert(unsafeMetadata.errors.some((error) => error.includes('Screenshot 1 type')));
  assert(unsafeMetadata.errors.some((error) => error.includes('name_localized language')));
  assert(unsafeMetadata.errors.some((error) => error.includes('name_localized.fr.dir')));
  assert(unsafeMetadata.errors.some((error) => error.includes('icons_localized is not a supported')));
  assert.strictEqual(api.buildManifestSnippet(), '');
  api.setState({
    manifestMetadata: {
      name: '',
      shortName: '',
      id: '',
      description: '',
      startUrl: './index.html',
      scope: './',
      display: 'standalone',
      categories: '',
      themeColor: '#123456',
      backgroundColor: '#123456',
      lang: 'en',
      dir: 'auto',
      monochrome: false,
      shortcuts: '',
      screenshots: '',
      localized: ''
    }
  });

  await api.generateSnippets([], []);
  const snippets = api.getState().generatedSnippets;
  assert(snippets.html.includes('/favicon.ico'), 'HTML snippet should include ICO link');
  assert(snippets.html.includes('/pwa/manifest.webmanifest'), 'HTML snippet should point PWA exports at the PWA manifest');
  assert(snippets.html.includes('apple-touch-startup-image'), 'HTML snippet should include splash image tags');
  ['plain', 'vite', 'next', 'astro', 'chrome', 'firefox', 'android', 'ios'].forEach((key) => {
    assert(snippets.handoff[key], `${key} handoff snippet should be generated`);
  });
  assert(snippets.handoff.plain.includes('Plain HTML'), 'plain handoff should label HTML head usage');
  assert(snippets.handoff.vite.includes('public/pwa/manifest.webmanifest'), 'Vite handoff should preserve generated public paths');
  assert(snippets.handoff.next.includes("manifest: '/pwa/manifest.webmanifest'"), 'Next handoff should point at generated manifest path');
  assert(snippets.handoff.next.includes("/pwa/icons/icon-192x192.png"), 'Next handoff should include generated icon paths');
  assert(snippets.handoff.astro.includes('<slot />'), 'Astro handoff should include layout slot');
  assert(snippets.handoff.chrome.includes('"manifest_version": 3'), 'Chrome handoff should emit MV3 JSON');
  assert(snippets.handoff.firefox.includes('"browser_specific_settings"'), 'Firefox handoff should include Gecko settings');
  assert(snippets.handoff.android.includes('Run the Android preset'), 'Android handoff should explain when Android files are not active');
  assert(snippets.handoff.ios.includes('Run the iOS preset'), 'iOS handoff should explain when iOS files are not active');
  assert.deepStrictEqual(Array.from(api.getSupportFiles(), (file) => file.name), [
    'snippets/head.html',
    'pwa/manifest.webmanifest',
    'README.txt'
  ]);

  api.setState({ deploymentUrlMode: 'relative', deploymentAssetBase: '', cacheBust: false, generatedSnippets: {} });
  await api.generateSnippets([], []);
  const relativeSnippets = api.getState().generatedSnippets;
  assert(relativeSnippets.html.includes('href="favicon.ico"'), 'Relative mode should omit the leading slash for favicon links');
  assert(relativeSnippets.html.includes('href="pwa/manifest.webmanifest"'), 'Relative mode should omit the leading slash for manifest links');
  assert(JSON.parse(relativeSnippets.manifest).icons.some((icon) => icon.src === 'pwa/icons/icon-192x192.png'));

  api.setState({
    deploymentUrlMode: 'custom',
    deploymentAssetBase: 'https://cdn.example.com/assets',
    cacheBust: true,
    generatedSnippets: {}
  });
  await api.generateSnippets([], []);
  const customSnippets = api.getState().generatedSnippets;
  const icoHash = crypto.createHash('sha256').update(Buffer.from([7, 7])).digest('hex').slice(0, 8);
  const pwaHash = crypto.createHash('sha256').update(Buffer.from([7, 7, 7, 7])).digest('hex').slice(0, 8);
  assert(customSnippets.html.includes(`href="https://cdn.example.com/assets/favicon.ico?v=${icoHash}"`), 'Custom mode should add base URL and icon cache query');
  assert(customSnippets.html.includes('href="https://cdn.example.com/assets/pwa/manifest.webmanifest"'), 'Custom mode should add base URL for manifest support file');
  assert(JSON.parse(customSnippets.manifest).icons.some((icon) => icon.src === `https://cdn.example.com/assets/pwa/icons/icon-192x192.png?v=${pwaHash}`));
  assert(customSnippets.handoff.next.includes(`https://cdn.example.com/assets/pwa/icons/icon-192x192.png?v=${pwaHash}`), 'Framework handoff should use selected URL policy');
  const headSupport = api.getSupportFiles().find((file) => file.name === 'snippets/head.html');
  assert(headSupport && (await headSupport.blob.text()).includes(`https://cdn.example.com/assets/favicon.ico?v=${icoHash}`), 'HTML support file should use selected URL policy');
  const customExportManifest = await api.buildExportManifest(api.getExportFiles());
  assert.strictEqual(customExportManifest.options.deploymentUrls.mode, 'custom');
  assert.strictEqual(customExportManifest.options.deploymentUrls.customBase, 'https://cdn.example.com/assets');
  assert.strictEqual(customExportManifest.options.deploymentUrls.cacheBust, true);
  assert.strictEqual(customExportManifest.options.processing.lossyQualityPercent, 92);
  assert.strictEqual(customExportManifest.options.processing.lossyQuality, 0.92);
  assert.strictEqual(customExportManifest.options.processing.sizeBudgetBytes, null);
  api.setState({
    deploymentUrlMode: 'custom',
    deploymentAssetBase: 'https://cdn.example.com/assets&brands',
    cacheBust: false,
    generatedSnippets: {}
  });
  await api.generateSnippets([], []);
  const escapedCustomSnippets = api.getState().generatedSnippets;
  assert(escapedCustomSnippets.html.includes('https://cdn.example.com/assets&amp;brands/favicon.ico'), 'HTML URL attributes should escape ampersands');
  assert(JSON.parse(escapedCustomSnippets.manifest).icons.some((icon) => icon.src === 'https://cdn.example.com/assets&brands/pwa/icons/icon-192x192.png'), 'JSON URLs should remain unescaped data');
  api.setState({
    deploymentUrlMode: 'custom',
    deploymentAssetBase: 'javascript:alert(1)',
    cacheBust: false,
    generatedSnippets: {}
  });
  assert.strictEqual(api.validateDeploymentUrlOptions().valid, false);
  assert.throws(() => api.deploymentUrlFor('favicon.ico'), /must use http/);
  api.setState({ deploymentUrlMode: 'root', deploymentAssetBase: '/assets/', cacheBust: false, generatedSnippets: {} });

  const pwaBundleFiles = makePwaBundleFiles();
  api.setState({
    sourceFileName: 'Acme App',
    activePresetKey: 'pwa',
    generatedFiles: pwaBundleFiles,
    generatedSnippets: {},
    replacementTargetNames: [],
    backgroundColor: '#123456'
  });
  await api.generateSnippets([], []);
  const pwaSnippets = api.getState().generatedSnippets;
  assert(pwaSnippets.html.includes('/pwa/splash/apple-splash-iphone-16-pro-max-1320x2868.png'), 'PWA snippets should include latest iPhone splash dimensions');
  assert(pwaSnippets.html.includes('(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)'), 'PWA snippets should use CSS points, scale factor, and portrait orientation');
  assert(pwaSnippets.html.includes('(device-width: 956px) and (device-height: 440px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)'), 'PWA snippets should swap CSS points for landscape orientation');
  assert.strictEqual((pwaSnippets.html.match(/apple-touch-startup-image/g) || []).length, 40, 'PWA snippets should include every generated splash orientation');
  const pwaValidation = await api.validateGeneratedExport({ artifactChecks: false });
  assert.strictEqual(pwaValidation.status, 'pass');
  assert(pwaValidation.checks.some((check) => check.label === 'PWA icon files' && check.status === 'pass'));
  const splashCheck = pwaValidation.checks.find((check) => check.label === 'PWA splash files');
  assert(splashCheck && splashCheck.detail.includes('1320x2868') && splashCheck.detail.includes('2868x1320'), 'PWA validation should name generated splash dimensions');
  assert(pwaValidation.checks.some((check) => check.label === 'Manifest icon metadata' && check.status === 'pass'));
  api.setState({
    featureSupport: {
      workerApi: true,
      offscreenCanvas: true,
      fileSystemAccess: false,
      fileHandling: false,
      blobWorker: false,
      webpEncode: false,
      webpChecked: true,
      avifEncode: false,
      avifChecked: true
    },
    generationStats: {
      workerJobs: 0,
      canvasFallbacks: 3,
      fallbackReasons: ['blob worker unavailable']
    }
  });
  const diagnostics = api.buildGenerationDiagnostics({
    selectedFormats: ['png'],
    validationResult: pwaValidation
  });
  const metric = (label) => diagnostics.metrics.find((item) => item.label === label)?.value;
  assert.strictEqual(metric('Selected preset'), 'PWA');
  assert.strictEqual(metric('Selected formats'), 'PNG');
  assert(metric('Skipped / hidden formats').includes('WebP hidden: encoder unsupported'));
  assert(metric('Skipped / hidden formats').includes('AVIF hidden: encoder unsupported'));
  assert(metric('Worker fallback state').includes('Canvas fallback for 3 resizes'));
  assert.strictEqual(metric('Lossy quality'), '92% for JPG/WebP/AVIF');
  assert.strictEqual(metric('Size budget'), 'Not set');
  assert.strictEqual(metric('Generated file count'), String(pwaBundleFiles.length));
  assert.strictEqual(metric('Total bytes'), `${pwaBundleFiles.length * 4} B`);
  assert.strictEqual(metric('Validation status'), 'Export validation passed');
  assert(diagnostics.features.some((feature) => feature.label === 'File System Access' && feature.status === 'warn'));
  assert(diagnostics.features.some((feature) => feature.label === 'PWA file handling' && feature.status === 'warn'));
  api.setState({ featureSupport: { fileHandling: true } });
  assert(api.getFeatureDiagnostics().some((feature) => feature.label === 'PWA file handling' && feature.status === 'pass'));

  api.setState({ lossyQualityPercent: 65, sizeBudgetKb: 0.1 });
  assert.strictEqual(api.getState().lossyQualityPercent, 65);
  assert.strictEqual(api.getState().sizeBudgetBytes, 102);
  const budgetValidation = await api.validateGeneratedExport({ artifactChecks: false });
  assert.strictEqual(budgetValidation.status, 'warn');
  assert(budgetValidation.checks.some((check) => check.label === 'Size budget' && check.status === 'warn'));
  const qualityDiagnostics = api.buildGenerationDiagnostics({
    selectedFormats: ['jpg', 'webp'],
    validationResult: budgetValidation
  });
  const qualityMetric = (label) => qualityDiagnostics.metrics.find((item) => item.label === label)?.value;
  assert.strictEqual(qualityMetric('Lossy quality'), '65% for JPG/WebP/AVIF');
  assert(qualityMetric('Size budget').includes('over 102 B budget'));
  const qualityExportManifest = await api.buildExportManifest(api.getExportFiles());
  assert.strictEqual(qualityExportManifest.options.processing.lossyQualityPercent, 65);
  assert.strictEqual(qualityExportManifest.options.processing.lossyQuality, 0.65);
  assert.strictEqual(qualityExportManifest.options.processing.sizeBudgetBytes, 102);
  api.setState({ lossyQualityPercent: 92, sizeBudgetKb: '' });
  assert(diagnostics.features.some((feature) => feature.label === 'Blob Worker' && feature.status === 'warn'));

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
  await api.generateSnippets([], []);
  const brokenValidation = await api.validateGeneratedExport({ artifactChecks: false });
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
  await api.generateSnippets([], []);
  assert(api.getState().generatedSnippets.handoff.chrome.includes('"128": "icons/icon128.png"'), 'Chrome MV3 handoff should use extension-relative icon paths');

  const socialFiles = [
    { name: 'social/og-image.png', blob: makeBlob(), size: { width: 1200, height: 630 }, format: 'png', role: 'social', socialTarget: 'open-graph' },
    { name: 'social/twitter-card.png', blob: makeBlob(), size: { width: 1200, height: 675 }, format: 'png', role: 'social', socialTarget: 'twitter' },
    { name: 'social/linkedin-preview.png', blob: makeBlob(), size: { width: 1200, height: 627 }, format: 'png', role: 'social', socialTarget: 'linkedin' }
  ];
  api.setState({
    sourceFileName: 'Acme Social',
    activePresetKey: 'social',
    generatedFiles: socialFiles,
    generatedSnippets: {},
    replacementTargetNames: [],
    manifestMetadata: {
      name: 'Acme Social',
      shortName: 'Acme',
      description: 'Social preview assets for Acme.'
    }
  });
  await api.generateSnippets([], []);
  const socialSnippets = api.getState().generatedSnippets;
  assert(socialSnippets.html.includes('property="og:image" content="/social/og-image.png"'), 'HTML snippet should include Open Graph image');
  assert(socialSnippets.social.includes('name="twitter:image" content="/social/twitter-card.png"'), 'Social snippet should include Twitter image');
  assert(socialSnippets.social.includes('property="og:image:width" content="1200"'), 'Social snippet should include image width');
  assert(api.getSupportFiles().some((file) => file.name === 'snippets/social-meta.html'), 'Social meta support file should be exported');
  const socialValidation = await api.validateGeneratedExport({ artifactChecks: false });
  assert.strictEqual(socialValidation.status, 'pass');
  assert(socialValidation.checks.some((check) => check.label === 'Social preview files' && check.status === 'pass'));

  api.setState({
    activePresetKey: 'android',
    generatedFiles: makeAndroidDensityFiles()
  });
  assert(api.buildAndroidSnippet().includes('<adaptive-icon'), 'Android snippet should include adaptive icon XML');
  await api.generateSnippets([], []);
  assert(api.getState().generatedSnippets.handoff.android.includes('android/mipmap-mdpi/ic_launcher_foreground.png -> app/src/main/res/mipmap-mdpi/ic_launcher_foreground.png'));
  assert(api.getState().generatedSnippets.handoff.android.includes('android/mipmap-xxxhdpi/ic_launcher.png -> app/src/main/res/mipmap-xxxhdpi/ic_launcher.png'));
  assert(api.getState().generatedSnippets.handoff.android.includes('mipmap-anydpi-v33/ic_launcher.xml'));
  assert(api.getState().generatedSnippets.handoff.android.includes('<monochrome android:drawable="@mipmap/ic_launcher_monochrome"'));
  assert(api.getState().generatedSnippets.handoff.android.includes('android:roundIcon="@mipmap/ic_launcher_round"'));
  const androidSupportNames = new Set(api.getSupportFiles().map((file) => file.name));
  [
    'android/mipmap-anydpi-v26/ic_launcher.xml',
    'android/mipmap-anydpi-v26/ic_launcher_round.xml',
    'android/mipmap-anydpi-v33/ic_launcher.xml',
    'android/mipmap-anydpi-v33/ic_launcher_round.xml',
    'android/AndroidManifest.xml'
  ].forEach((name) => assert(androidSupportNames.has(name), `${name} should be exported`));
  const androidValidation = await api.validateGeneratedExport({ artifactChecks: false });
  assert.strictEqual(androidValidation.status, 'pass', 'Android density bucket validation should pass');
  assert(androidValidation.checks.some((check) => check.label === 'Android adaptive icon files' && check.detail.includes('25 expected files')));
  assert(androidValidation.checks.some((check) => check.label === 'Android launcher references' && check.status === 'pass'));
  api.setState({
    activePresetKey: 'ios',
    generatedFiles: [
      { name: 'ios/AppIcon.appiconset/Icon-App-1024x1024-1x.png', blob: makeBlob(), size: { width: 1024, height: 1024 }, format: 'png', role: 'ios' }
    ]
  });
  assert(JSON.parse(api.buildIosContents()).images.some((image) => image.filename === 'Icon-App-1024x1024-1x.png'));
  await api.generateSnippets([], []);
  assert(api.getState().generatedSnippets.handoff.ios.includes('ios/AppIcon.appiconset/Icon-App-1024x1024-1x.png'));
  api.setState({ activePresetKey: 'windows', backgroundColor: '#abcdef' });
  assert(api.buildWindowsBrowserConfig().includes('<TileColor>#abcdef</TileColor>'));

  api.setState({
    activePresetKey: 'pwa',
    sourceFileName: 'Acme App',
    sourceMode: 'text',
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
  const exportFilesWithManifest = await api.getExportFilesWithManifest();
  const exportManifestFile = exportFilesWithManifest.find((file) => file.name === 'iconforge-export.json');
  assert(exportManifestFile, 'export manifest file should be appended to exports');
  const exportManifest = JSON.parse(await exportManifestFile.blob.text());
  assert.strictEqual(exportManifest.schema, 'iconforge-export-v1');
  assert.strictEqual(exportManifest.schemaVersion, 2);
  assert.strictEqual(exportManifest.appVersion, declaredVersion);
  assert.strictEqual(exportManifest.version, declaredVersion);
  assert.strictEqual(exportManifest.compatibility.minimumReaderSchemaVersion, 1);
  assert(exportManifest.compatibility.migrations.some((migration) => migration.schemaVersion === 2 && migration.compatibility === 'additive'));
  assert.strictEqual(exportManifest.preset, 'pwa');
  assert.strictEqual(exportManifest.source.mode, 'text');
  assert.strictEqual(exportManifest.source.name, 'Acme App');
  assert.strictEqual(exportManifest.options.replacementTemplate.active, true);
  assert(exportManifest.options.replacementTemplate.targets.includes('pwa/icons/icon-192x192.png'));
  assert(!exportManifest.files.some((file) => file.name === 'iconforge-export.json'), 'manifest should describe exported payload files, not itself');
  const iconRecord = exportManifest.files.find((file) => file.name === 'pwa/icons/icon-192x192.png');
  assert(iconRecord, 'manifest should include matched PWA icon file');
  assert.strictEqual(iconRecord.kind, 'image');
  assert.strictEqual(iconRecord.mimeType, 'image/png');
  assert.strictEqual(iconRecord.byteSize, 4);
  assert.deepStrictEqual(iconRecord.dimensions, { width: 192, height: 192 });
  assert.strictEqual(iconRecord.sha256, crypto.createHash('sha256').update(Buffer.from([7, 7, 7, 7])).digest('hex'));
  assert(exportManifest.files.some((file) => file.name === 'README.txt' && file.kind === 'support'));
  assert.strictEqual(api.inspectExportManifest(exportManifest).code, 'EXPORT_MANIFEST_VALID');
  const migratedLegacyManifest = api.inspectExportManifest({
    schema: 'iconforge-export-v1',
    version: 'v0.4.1',
    files: []
  });
  assert.strictEqual(migratedLegacyManifest.valid, true);
  assert.strictEqual(migratedLegacyManifest.migrated, true);
  assert.strictEqual(migratedLegacyManifest.manifest.schemaVersion, 1);
  assert.strictEqual(migratedLegacyManifest.manifest.appVersion, 'v0.4.1');
  const futureManifest = api.inspectExportManifest({
    schema: 'iconforge-export-v1',
    schemaVersion: 99
  });
  assert.strictEqual(futureManifest.valid, false);
  assert.strictEqual(futureManifest.code, 'EXPORT_SCHEMA_UNSUPPORTED');
  assert.match(futureManifest.message, /newer than supported version 2/);
  const reforgeManifest = JSON.parse(JSON.stringify(exportManifest));
  reforgeManifest.options = {
    ...reforgeManifest.options,
    sizes: [{ width: 64, height: 96 }, 192],
    formats: ['png', 'webp'],
    processing: {
      paddingPercent: 13,
      lossyQualityPercent: 81,
      sizeBudgetBytes: 12288,
      resample: 'nearest',
      backgroundMode: 'gradient',
      backgroundColor: '#112233',
      backgroundColor2: '#445566',
      effect: 'desaturate',
      dropShadow: true
    },
    replacementTemplate: {
      active: true,
      targets: ['assets/icon-64.png', 'manifest.webmanifest']
    },
    deploymentUrls: {
      mode: 'custom',
      customBase: 'https://cdn.example.com/icons/',
      cacheBust: true
    },
    manifestMetadata: {
      name: 'Reforged App',
      shortName: 'Reforged',
      startUrl: './launch',
      scope: './',
      display: 'standalone',
      themeColor: '#112233',
      backgroundColor: '#445566'
    }
  };
  const reforgeInspection = api.inspectReforgeManifest(reforgeManifest);
  assert.strictEqual(reforgeInspection.valid, true);
  const reforgeResult = api.applyReforgeManifest(reforgeManifest);
  assert.strictEqual(reforgeResult.valid, true);
  assert.match(reforgeResult.message, /Re-select source artwork/);
  assert.strictEqual(api.getState().sourceFileName, '');
  assert.strictEqual(api.getState().activePresetKey, 'pwa');
  assert.deepStrictEqual(api.getState().replacementTargetNames.sort(), ['assets/icon-64.png', 'manifest.webmanifest']);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(api.getState().deploymentUrls)), {
    mode: 'custom',
    customBase: 'https://cdn.example.com/icons/',
    cacheBust: true
  });
  assert.strictEqual(api.getState().lossyQualityPercent, 81);
  assert.strictEqual(api.getState().sizeBudgetBytes, 12288);
  const legacyReforgeManifest = {
    ...reforgeManifest,
    schemaVersion: undefined,
    version: 'v0.4.1'
  };
  const legacyReforgeInspection = api.inspectReforgeManifest(legacyReforgeManifest);
  assert.strictEqual(legacyReforgeInspection.valid, true);
  assert.strictEqual(legacyReforgeInspection.migrated, true);
  api.setState({ activePresetKey: 'pwa', replacementTargetNames: ['keep-me.png'] });
  const stateBeforeRejectedReforge = JSON.stringify(api.getState());
  assert.strictEqual(api.applyReforgeManifest({ ...reforgeManifest, schemaVersion: 99 }).valid, false);
  assert.strictEqual(JSON.stringify(api.getState()), stateBeforeRejectedReforge, 'future manifests must not mutate state');
  assert.strictEqual(api.applyReforgeManifest({ ...reforgeManifest, options: { sizes: ['bad'], formats: ['png'] } }).valid, false);
  assert.strictEqual(JSON.stringify(api.getState()), stateBeforeRejectedReforge, 'malformed manifests must not mutate state');
  api.setState({ generatedFiles, generatedSnippets: snippets, activePresetKey: 'pwa' });

  api.setState({
    featureSupport: {
      webpEncode: true,
      webpChecked: true,
      avifEncode: false,
      avifChecked: true,
      workerApi: true,
      offscreenCanvas: false,
      fileHandling: true,
      blobWorker: true
    },
    generationStats: {
      workerJobs: 2,
      canvasFallbacks: 1,
      fallbackReasons: ['OffscreenCanvas unavailable']
    },
    latestOperationSnapshot: {
      kind: 'generation',
      status: 'completed',
      startedAt: '2026-07-25T12:00:00.000Z',
      endedAt: '2026-07-25T12:00:00.025Z',
      durationMs: 25,
      completedSteps: 2,
      totalSteps: 2,
      currentStage: null,
      currentFile: null,
      stages: [
        { stage: 'Encoding', status: 'completed', count: 1, durationMs: 10, lastFile: 'icon.png' },
        { stage: 'Validating', status: 'completed', count: 1, durationMs: 15, lastFile: 'artifact contracts' }
      ],
      error: null
    }
  });
  const diagnosticsValidation = await api.validateGeneratedExport({ artifactChecks: false });
  const diagnosticsReport = api.buildDiagnosticsSupportReport({
    selectedFormats: ['png', 'webp'],
    validationResult: diagnosticsValidation,
    error: new Error('PNG encoder failed: no image data')
  });
  assert.strictEqual(diagnosticsReport.schema, 'iconforge-diagnostics');
  assert.strictEqual(diagnosticsReport.schemaVersion, 2);
  assert.strictEqual(diagnosticsReport.status, 'error');
  assert.strictEqual(diagnosticsReport.app.version, declaredVersion);
  assert.strictEqual(diagnosticsReport.preset.key, 'pwa');
  assert.deepStrictEqual([...diagnosticsReport.selectedFormats], ['png', 'webp']);
  assert.strictEqual(diagnosticsReport.browserSupport.flags.webpEncode, true);
  assert.strictEqual(diagnosticsReport.browserSupport.flags.fileHandling, true);
  assert(diagnosticsReport.browserSupport.checks.some((check) => check.label === 'AVIF encoder' && check.status === 'warn'));
  assert(diagnosticsReport.generation.workerFallbackState.includes('canvas fallback for 1'));
  assert.strictEqual(diagnosticsReport.generation.workerJobs, 2);
  assert.strictEqual(diagnosticsReport.operation.durationMs, 25);
  assert.strictEqual(diagnosticsReport.operation.stages[0].stage, 'Encoding');
  assert.strictEqual(diagnosticsReport.serviceWorker.supported, true);
  assert.strictEqual(diagnosticsReport.serviceWorker.controlled, false);
  assert.strictEqual(diagnosticsReport.folderExport.status, 'failed-partial');
  assert.deepStrictEqual([...diagnosticsReport.folderExport.written], ['icon.png']);
  assert(diagnosticsReport.validation.checks.length > 0, 'diagnostics JSON should include validation checks');
  assert.strictEqual(diagnosticsReport.errors[0].code, 'ENCODER_FAILED');
  assert.strictEqual(diagnosticsReport.errors[0].stage, 'generation');
  assert.strictEqual(diagnosticsReport.encoderErrors[0].message, 'PNG encoder failed: no image data');
  const diagnosticsIconRecord = diagnosticsReport.generatedFileMetadata.find((file) => file.name === 'pwa/icons/icon-192x192.png');
  assert(diagnosticsIconRecord, 'diagnostics JSON should include generated file metadata');
  assert.strictEqual(diagnosticsIconRecord.byteSize, 4);
  assert(!Object.prototype.hasOwnProperty.call(diagnosticsIconRecord, 'blob'), 'diagnostics JSON must not include Blob payloads');
  assert(!JSON.stringify(diagnosticsReport).includes('data:image'), 'diagnostics JSON must not include source image bytes');
  api.renderGenerationDiagnostics({ selectedFormats: ['png'], validationResult: diagnosticsValidation });
  assert.strictEqual(api.getState().latestDiagnosticsSupportReport.selectedFormats[0], 'png');

  api.setState({
    sourceMode: 'upload',
    sourceFileName: 'Sensitive Client Logo',
    sourceImageSize: { width: 128, height: 128 },
    originalImageData: 'data:image/png;base64,RESTOREDRAFT',
    cropRegion: { x: 4, y: 5, width: 64, height: 63 },
    draftSourceEnabled: false,
    activePresetKey: 'web',
    lossyQualityPercent: 78,
    sizeBudgetKb: 2,
    deploymentUrlMode: 'custom',
    deploymentAssetBase: 'https://cdn.example.test/icons',
    cacheBust: true,
    manifestMetadata: {
      name: 'Draft App',
      shortName: 'Draft',
      id: './draft/',
      description: 'Saved draft manifest.',
      lang: 'en',
      dir: 'ltr',
      monochrome: true
    }
  });
  let draft = JSON.parse(JSON.stringify(api.buildDraftSnapshot()));
  assert.strictEqual(draft.schema, 'iconforge-draft-v2');
  assert.strictEqual(draft.restoreSourceImage, false);
  assert.strictEqual(draft.sourceImage, null, 'source image data should be omitted until restore is enabled');
  assert.strictEqual(draft.cropRegion.width, 64);
  assert.strictEqual(draft.processing.lossyQuality, '78');
  assert.strictEqual(draft.processing.sizeBudgetKb, '2');
  assert.strictEqual(draft.deploymentUrls.cacheBust, true);
  assert.strictEqual(draft.manifestMetadata.name, 'Draft App');

  api.setState({ draftSourceEnabled: true });
  draft = JSON.parse(JSON.stringify(api.saveDraftState({ silent: true })));
  assert.strictEqual(draft.restoreSourceImage, true);
  assert.strictEqual(draft.sourceImage.name, 'restored-image', 'upload draft should not preserve the original local filename');
  assert.strictEqual(draft.sourceImage.dataUrl, 'data:image/png;base64,RESTOREDRAFT');
  const savedDraft = JSON.parse(JSON.stringify(api.readDraftSnapshot()));
  assert.strictEqual(savedDraft.sourceImage.width, 128);
  assert.strictEqual(savedDraft.cropRegion.height, 63);
  assert.match(api.getState().draftStatus, /Saved just now.*source image included.*expires in 30 days/);
  assert.match(api.draftStorageSummary(savedDraft), /Saved just now.*B.*expires in 30 days/);

  const legacyDraft = {
    ...savedDraft,
    schema: 'iconforge-draft-v1',
    restoreSourceImage: false,
    sourceImage: {
      dataUrl: 'data:image/png;base64,SHOULD_NOT_MIGRATE',
      width: 1,
      height: 1
    }
  };
  const migratedRecord = JSON.parse(JSON.stringify(api.inspectDraftRecord(JSON.stringify(legacyDraft))));
  assert.strictEqual(migratedRecord.valid, true);
  assert.strictEqual(migratedRecord.status, 'migrated');
  assert.strictEqual(migratedRecord.draft.schema, api.DRAFT_SCHEMA);
  assert.strictEqual(migratedRecord.draft.sourceImage, null, 'migration must strip image bytes without active opt-in');

  const expiredRecord = api.inspectDraftRecord(JSON.stringify({
    ...savedDraft,
    savedAt: new Date(Date.now() - api.DRAFT_TTL_MS - 1000).toISOString()
  }));
  assert.strictEqual(expiredRecord.valid, false);
  assert.strictEqual(expiredRecord.status, 'expired');
  assert.strictEqual(api.inspectDraftRecord('{').status, 'corrupt');
  assert.strictEqual(api.inspectDraftRecord(JSON.stringify({ ...savedDraft, schema: 'unknown-draft-v9' })).status, 'unsupported');

  api.clearDraftState();
  assert.strictEqual(api.readDraftSnapshot(), null);
  assert.strictEqual(api.getState().draftSourceEnabled, false);
  assert.strictEqual(api.saveDraftState({ silent: true }), null, 'clear should suppress beforeunload-style resaves until another change');

  api.setStoredDraftForTest(JSON.stringify(legacyDraft), api.LEGACY_DRAFT_STORAGE_KEYS[0]);
  const migratedStoredDraft = api.readDraftSnapshot({ reportStatus: false });
  assert.strictEqual(migratedStoredDraft.schema, api.DRAFT_SCHEMA);
  assert.strictEqual(api.getStoredDraftForTest(api.LEGACY_DRAFT_STORAGE_KEYS[0]), null);
  assert(api.getStoredDraftForTest(), 'legacy migration should write the current storage key');

  api.setStoredDraftForTest(JSON.stringify({ ...savedDraft, schema: 'unknown-draft-v9' }));
  assert.strictEqual(api.readDraftSnapshot({ reportStatus: false }), null);
  assert.strictEqual(api.getStoredDraftForTest(), null, 'unknown schemas should be removed');

  api.setState({ draftEnabled: false });
  api.setStoredDraftForTest(JSON.stringify(savedDraft));
  assert.strictEqual(api.saveDraftState({ silent: true }), null);
  api.clearDraftState();
  assert.strictEqual(api.getStoredDraftForTest(), null);

  api.setState({ draftEnabled: true, draftClearOnExport: true });
  api.setStoredDraftForTest(JSON.stringify(savedDraft));
  assert.strictEqual(api.clearDraftAfterExportIfRequested(), true);
  assert.strictEqual(api.getStoredDraftForTest(), null);

  console.log('export regression tests ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
