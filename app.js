function buildZip(files) {
    const enc = new TextEncoder();
    const localHeaders = [];
    const centralEntries = [];
    let offset = 0;

    for (const { name, data } of files) {
        const nameBytes = enc.encode(name);
        const crc = crc32(data);
        const local = new Uint8Array(30 + nameBytes.length + data.length);
        const v = new DataView(local.buffer);
        v.setUint32(0, 0x04034b50, true);
        v.setUint16(4, 20, true);
        v.setUint16(6, 0, true);
        v.setUint16(8, 0, true);
        v.setUint16(10, 0, true);
        v.setUint16(12, 0, true);
        v.setUint32(14, crc, true);
        v.setUint32(18, data.length, true);
        v.setUint32(22, data.length, true);
        v.setUint16(26, nameBytes.length, true);
        v.setUint16(28, 0, true);
        local.set(nameBytes, 30);
        local.set(data, 30 + nameBytes.length);
        localHeaders.push(local);

        const central = new Uint8Array(46 + nameBytes.length);
        const cv = new DataView(central.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint16(12, 0, true);
        cv.setUint16(14, 0, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, data.length, true);
        cv.setUint32(24, data.length, true);
        cv.setUint16(28, nameBytes.length, true);
        cv.setUint32(42, offset, true);
        central.set(nameBytes, 46);
        centralEntries.push(central);

        offset += local.length;
    }

    const centralSize = centralEntries.reduce((s, e) => s + e.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);

    const total = offset + centralSize + 22;
    const out = new Uint8Array(total);
    let pos = 0;
    for (const h of localHeaders) { out.set(h, pos); pos += h.length; }
    for (const c of centralEntries) { out.set(c, pos); pos += c.length; }
    out.set(eocd, pos);
    return new Blob([out], { type: 'application/zip' });
}

function crc32(data) {
    let crc = 0xFFFFFFFF;
    if (!crc32.table) {
        crc32.table = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
            let c = i;
            for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
            crc32.table[i] = c;
        }
    }
    for (let i = 0; i < data.length; i++) crc = crc32.table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

const APP_VERSION = globalThis.ICONFORGE_VERSION;
if (!/^v\d+\.\d+\.\d+$/.test(APP_VERSION || '')) {
    throw new Error('IconForge version metadata is missing or invalid.');
}
const MAX_CANVAS_PIXELS = 16_777_216; // Safari limit
const DRAFT_STORAGE_KEY = 'iconforge-draft-v2';
const LEGACY_DRAFT_STORAGE_KEYS = Object.freeze(['iconforge-draft-v1']);
const DRAFT_PREFERENCES_KEY = 'iconforge-draft-preferences-v1';
const DRAFT_SCHEMA = 'iconforge-draft-v2';
const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_DRAFT_BYTES = 4 * 1024 * 1024;

function limitImageSize(width, height) {
    const pixels = width * height;
    if (pixels <= MAX_CANVAS_PIXELS) return { width, height, scaled: false };
    const scale = Math.sqrt(MAX_CANVAS_PIXELS / pixels);
    return { width: Math.floor(width * scale), height: Math.floor(height * scale), scaled: true };
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function normalizeSvgColor(value, fallback) {
    const color = String(value || '').trim();
    return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : fallback;
}

function setPreviewInfo(name, width, height, suffix) {
    previewInfo.textContent = '';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = name;
    previewInfo.appendChild(nameSpan);
    previewInfo.appendChild(document.createTextNode(` — ${width} × ${height}`));
    if (suffix) {
        const small = document.createElement('small');
        small.textContent = ` (${suffix})`;
        previewInfo.appendChild(small);
    }
}

// State
let sourceImage = null;
let sourceFileName = '';
let sourceMode = 'upload';
let generatedFiles = [];
let activePresetKey = null;
let replacementTargetNames = new Set();
let generatedSnippets = {};
let assetCacheBusters = new Map();
let activeOperation = null;

const OUTPUT_FORMATS = ['png', 'jpg', 'ico', 'webp', 'avif', 'svg'];
const UI_STRINGS = Object.freeze({
    shell: {
        appName: 'Icon Forge',
        tagline: 'Generate favicons, PWA icons, and extension assets in seconds',
        trustSignal: '100% client-side - your images never leave your browser',
        sourceImage: 'Source Image',
        upload: 'Upload',
        text: 'Text',
        emoji: 'Emoji',
        draftRecovery: 'Draft Recovery',
        clearDraft: 'Clear Draft',
        saveDraft: 'Save settings for recovery',
        restoreSourceImage: 'Restore source image after reload',
        clearDraftOnExport: 'Clear saved draft after ZIP or folder export',
        draftPrivacy: 'Settings save locally in this browser. Source images are stored only when this box is enabled.'
    },
    formats: {
        png: 'PNG',
        jpg: 'JPG',
        ico: 'ICO',
        webp: 'WebP',
        avif: 'AVIF',
        svg: 'SVG'
    },
    presets: {
        web: 'Modern Web',
        pwa: 'PWA',
        extension: 'Extension',
        android: 'Android',
        ios: 'iOS',
        windows: 'Windows',
        social: 'Social Preview',
        all: 'All Sizes'
    },
    handoffTabs: {
        plain: 'Plain HTML',
        vite: 'Vite',
        next: 'Next.js app router',
        astro: 'Astro',
        chrome: 'Chrome MV3',
        firefox: 'Firefox MV3',
        android: 'Android',
        ios: 'iOS'
    },
    diagnostics: {
        pending: 'Checking browser support.',
        title: 'Generation diagnostics',
        failedTitle: 'Generation failed',
        detail: '{count} generated for {preset} export.',
        metrics: {
            selectedPreset: 'Selected preset',
            selectedFormats: 'Selected formats',
            skippedFormats: 'Skipped / hidden formats',
            workerFallback: 'Worker fallback state',
            lossyQuality: 'Lossy quality',
            sizeBudget: 'Size budget',
            generatedFileCount: 'Generated file count',
            totalBytes: 'Total bytes',
            validationStatus: 'Validation status'
        },
        features: {
            webp: ['WebP encoder', 'WebP output is available.', 'WebP output is hidden because this browser cannot encode it.'],
            avif: ['AVIF encoder', 'AVIF output is available.', 'AVIF output is hidden because this browser cannot encode it.'],
            fileSystemAccess: ['File System Access', 'Save to Folder is available.', 'ZIP download remains available; direct folder save is hidden.'],
            fileHandling: ['PWA file handling', 'Installed app launches can receive image files.', 'Open-with-file support is unavailable; upload, paste, and drag/drop still work.'],
            offscreenCanvas: ['OffscreenCanvas', 'Worker resizing can use OffscreenCanvas.', 'Canvas fallback will be used for image resizing.'],
            blobWorker: ['Blob Worker', 'Resize worker initialized.', 'Resize worker did not initialize; canvas fallback is available.'],
            workerApiUnavailable: 'Worker API is unavailable; canvas fallback is available.'
        }
    },
    status: {
        diagnosticsCopied: 'Diagnostics JSON copied',
        diagnosticsCopyFailed: 'Failed to copy diagnostics JSON',
        diagnosticsDownloaded: 'Diagnostics JSON downloaded',
        diagnosticsDownloadFailed: 'Failed to download diagnostics JSON: {message}',
        launchedFileOpened: 'Opened {name} from the operating system.',
        launchedFileOpenedExtra: 'Opened {name}; {count} additional {fileWord} ignored.',
        launchedFileFailed: 'Could not open launched file: {message}',
        imageInvalid: 'Please select a valid image file.',
        fileTooLarge: 'File too large ({size} MB). Maximum is 200 MB.',
        largeFile: 'Large file ({size} MB) - processing may be slow.',
        imageDownscaled: 'Image was downscaled from {fromWidth}x{fromHeight} to {toWidth}x{toHeight} (browser canvas limit)'
    },
    draft: {
        tooLarge: 'Draft settings saved locally. Source image was too large for browser storage.',
        saveFailed: 'Draft could not be saved in this browser.',
        clearFailed: 'Draft could not be cleared in this browser.',
        cleared: 'Saved draft cleared. Current work stays open until you reload or choose a different source.',
        restoredWithSource: 'Draft restored locally, including the saved source image.',
        restoredSettings: 'Draft settings restored locally. Enable source restore to keep the image across reloads.',
        sourceLoadFailed: 'Draft settings restored, but the saved source image could not be loaded.',
        broken: 'Saved draft could not be restored. Clear Draft removes the broken local copy.'
    },
    validation: {
        titles: {
            pass: 'Export validation passed',
            warn: 'Export validation has warnings',
            fail: 'Export validation failed'
        },
        details: {
            pass: 'The generated bundle matches the selected platform rules.',
            review: 'Review the checks below before deploying this export.'
        },
        labels: {
            supportFiles: 'Deployable support files',
            manifestMetadata: 'Manifest icon metadata',
            maskableSafeZone: 'Maskable safe zone',
            sizeBudget: 'Size budget',
            generatedFiles: 'Generated files',
            platformRules: 'Platform file rules'
        }
    },
    snippets: {
        noGeneratedFiles: '- No generated files yet',
        noApplicableTags: '<!-- No applicable tags for selected formats -->',
        androidMissing: 'Run the Android preset to generate adaptive icon PNGs and ic_launcher.xml handoff files.',
        iosMissing: 'Run the iOS preset to generate AppIcon.appiconset PNGs and Contents.json.'
    }
});
const FORMAT_LABELS = UI_STRINGS.formats;
const PRESET_LABELS = UI_STRINGS.presets;

function getUiString(path) {
    return path.split('.').reduce((value, part) => value?.[part], UI_STRINGS);
}

function uiText(path, replacements = {}, fallback = '') {
    const template = getUiString(path);
    const value = typeof template === 'string' ? template : fallback || path;
    return value.replace(/\{(\w+)\}/g, (_, key) => {
        return Object.prototype.hasOwnProperty.call(replacements, key) ? String(replacements[key]) : `{${key}}`;
    });
}

function applyUiStrings(root = document) {
    root.querySelectorAll('[data-i18n]').forEach(element => {
        const value = getUiString(element.dataset.i18n);
        if (typeof value === 'string') element.textContent = value;
    });
    root.querySelectorAll('[data-i18n-title]').forEach(element => {
        const value = getUiString(element.dataset.i18nTitle);
        if (typeof value === 'string') element.title = value;
    });
    root.querySelectorAll('[data-i18n-aria-label]').forEach(element => {
        const value = getUiString(element.dataset.i18nAriaLabel);
        if (typeof value === 'string') element.setAttribute('aria-label', value);
    });
}
const HANDOFF_SNIPPET_TABS = [
    { key: 'plain', label: uiText('handoffTabs.plain'), tabId: 'handoffTabPlain' },
    { key: 'vite', label: uiText('handoffTabs.vite'), tabId: 'handoffTabVite' },
    { key: 'next', label: uiText('handoffTabs.next'), tabId: 'handoffTabNext' },
    { key: 'astro', label: uiText('handoffTabs.astro'), tabId: 'handoffTabAstro' },
    { key: 'chrome', label: uiText('handoffTabs.chrome'), tabId: 'handoffTabChrome' },
    { key: 'firefox', label: uiText('handoffTabs.firefox'), tabId: 'handoffTabFirefox' },
    { key: 'android', label: uiText('handoffTabs.android'), tabId: 'handoffTabAndroid' },
    { key: 'ios', label: uiText('handoffTabs.ios'), tabId: 'handoffTabIos' }
];
const featureSupport = {
    workerApi: typeof Worker !== 'undefined',
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    fileSystemAccess: typeof window !== 'undefined' && 'showDirectoryPicker' in window,
    fileHandling: typeof window !== 'undefined' && 'launchQueue' in window && typeof LaunchParams !== 'undefined' && 'files' in LaunchParams.prototype,
    blobWorker: false,
    webpEncode: false,
    webpChecked: false,
    avifEncode: false,
    avifChecked: false
};
let generationStats = createGenerationStats();
let activeHandoffSnippetKey = 'plain';
let latestDiagnosticsSupportReport = null;

// Crop state
let originalImageData = null;  // Store original for reset
let cropRegion = null;  // {x, y, width, height}
let isManualCropMode = false;
let isDragging = false;
let dragStart = null;
let currentCropRect = null;

// DOM Elements
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const previewContainer = document.getElementById('previewContainer');
const previewImage = document.getElementById('previewImage');
const previewInfo = document.getElementById('previewInfo');
const btnChange = document.getElementById('btnChange');
const sizeGrid = document.getElementById('sizeGrid');
const customWidth = document.getElementById('customWidth');
const customHeight = document.getElementById('customHeight');
const btnAddSize = document.getElementById('btnAddSize');
const formatOptions = document.getElementById('formatOptions');
const btnGenerate = document.getElementById('btnGenerate');
const btnCancelOperation = document.getElementById('btnCancelOperation');
const generationProgress = document.getElementById('generationProgress');
const generationProgressBar = document.getElementById('generationProgressBar');
const generationProgressFill = document.getElementById('generationProgressFill');
const generationProgressLabel = document.getElementById('generationProgressLabel');
const status = document.getElementById('status');
const outputSection = document.getElementById('outputSection');
const outputGrid = document.getElementById('outputGrid');
const btnDownloadAll = document.getElementById('btnDownloadAll');
const btnSaveToFolder = document.getElementById('btnSaveToFolder');
const diagnosticsSection = document.getElementById('diagnosticsSection');
const diagnosticsSummary = document.getElementById('diagnosticsSummary');
const diagnosticsGrid = document.getElementById('diagnosticsGrid');
const diagnosticsFeatureList = document.getElementById('diagnosticsFeatureList');
const btnCopyDiagnostics = document.getElementById('btnCopyDiagnostics');
const btnDownloadDiagnostics = document.getElementById('btnDownloadDiagnostics');
const handoffTabs = document.getElementById('handoffTabs');
const handoffSnippetTitle = document.getElementById('handoffSnippetTitle');
const handoffSnippet = document.getElementById('handoffSnippet');
const safePaddingSlider = document.getElementById('safePaddingSlider');
const safePaddingValue = document.getElementById('safePaddingValue');
const lossyQualitySlider = document.getElementById('lossyQualitySlider');
const lossyQualityValue = document.getElementById('lossyQualityValue');
const sizeBudgetInput = document.getElementById('sizeBudgetInput');
const resampleSelect = document.getElementById('resampleSelect');
const backgroundMode = document.getElementById('backgroundMode');
const backgroundColor = document.getElementById('backgroundColor');
const backgroundColor2 = document.getElementById('backgroundColor2');
const svgLightColor = document.getElementById('svgLightColor');
const svgDarkColor = document.getElementById('svgDarkColor');
const manifestMetadataGrid = document.getElementById('manifestMetadataGrid');
const manifestMetadataStatus = document.getElementById('manifestMetadataStatus');
const manifestName = document.getElementById('manifestName');
const manifestShortName = document.getElementById('manifestShortName');
const manifestId = document.getElementById('manifestId');
const manifestDescription = document.getElementById('manifestDescription');
const manifestStartUrl = document.getElementById('manifestStartUrl');
const manifestScope = document.getElementById('manifestScope');
const manifestDisplay = document.getElementById('manifestDisplay');
const manifestCategories = document.getElementById('manifestCategories');
const manifestThemeColor = document.getElementById('manifestThemeColor');
const manifestBackgroundColor = document.getElementById('manifestBackgroundColor');
const manifestLang = document.getElementById('manifestLang');
const manifestDir = document.getElementById('manifestDir');
const manifestMonochrome = document.getElementById('manifestMonochrome');
const manifestShortcuts = document.getElementById('manifestShortcuts');
const manifestScreenshots = document.getElementById('manifestScreenshots');
const deploymentUrlGrid = document.getElementById('deploymentUrlGrid');
const deploymentUrlStatus = document.getElementById('deploymentUrlStatus');
const assetUrlMode = document.getElementById('assetUrlMode');
const assetUrlBase = document.getElementById('assetUrlBase');
const cacheBustToggle = document.getElementById('cacheBustToggle');
const effectSelect = document.getElementById('effectSelect');
const dropShadowToggle = document.getElementById('dropShadowToggle');
const maskPreviewCanvas = document.getElementById('maskPreviewCanvas');
const maskPreviewCtx = maskPreviewCanvas.getContext('2d');
const maskShapeSelect = document.getElementById('maskShapeSelect');
const replaceInput = document.getElementById('replaceInput');
const replaceStatus = document.getElementById('replaceStatus');
const draftSourceToggle = document.getElementById('draftSourceToggle');
const draftEnabledToggle = document.getElementById('draftEnabledToggle');
const draftClearOnExportToggle = document.getElementById('draftClearOnExportToggle');
const btnClearDraft = document.getElementById('btnClearDraft');
const draftStatus = document.getElementById('draftStatus');

// Crop DOM Elements
const cropSection = document.getElementById('cropSection');
const cropCanvas = document.getElementById('cropCanvas');
const cropCtx = cropCanvas.getContext('2d');
const btnAutoCrop = document.getElementById('btnAutoCrop');
const btnManualCrop = document.getElementById('btnManualCrop');
const btnResetCrop = document.getElementById('btnResetCrop');
const btnApplyCrop = document.getElementById('btnApplyCrop');
const cropDimensions = document.getElementById('cropDimensions');
const cropStatus = document.getElementById('cropStatus');
const toleranceSlider = document.getElementById('toleranceSlider');
const toleranceValue = document.getElementById('toleranceValue');

// Numeric crop DOM elements
const cropXInput = document.getElementById('cropX');
const cropYInput = document.getElementById('cropY');
const cropWInput = document.getElementById('cropW');
const cropHInput = document.getElementById('cropH');
const btnApplyNumericCrop = document.getElementById('btnApplyNumericCrop');

applyUiStrings();

function setElementVisible(element, visible, display = '') {
    if (!element) return;
    element.classList.toggle('is-hidden', !visible);
    element.style.display = visible ? display : 'none';
}

let draftSaveTimer = null;
let isRestoringDraft = false;
let draftClearedUntilChange = false;

function draftStorage() {
    try {
        return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
        return null;
    }
}

function setDraftStatus(message, type = '') {
    if (!draftStatus) return;
    draftStatus.textContent = message;
    draftStatus.classList.toggle('warning', type === 'warning');
    draftStatus.classList.toggle('success', type === 'success');
}

function validDraftCrop(region, img = sourceImage) {
    if (!region || !img) return null;
    const x = Math.max(0, Math.round(Number(region.x) || 0));
    const y = Math.max(0, Math.round(Number(region.y) || 0));
    const width = Math.min(Math.round(Number(region.width) || 0), img.naturalWidth - x);
    const height = Math.min(Math.round(Number(region.height) || 0), img.naturalHeight - y);
    return width > 0 && height > 0 ? { x, y, width, height } : null;
}

function manifestDraftValues() {
    return {
        name: manifestName.value,
        shortName: manifestShortName.value,
        id: manifestId.value,
        description: manifestDescription.value,
        startUrl: manifestStartUrl.value,
        scope: manifestScope.value,
        display: manifestDisplay.value,
        categories: manifestCategories.value,
        themeColor: manifestThemeColor.value,
        backgroundColor: manifestBackgroundColor.value,
        lang: manifestLang.value,
        dir: manifestDir.value,
        monochrome: Boolean(manifestMonochrome.checked),
        shortcuts: manifestShortcuts.value,
        screenshots: manifestScreenshots.value
    };
}

function applyManifestDraftValues(values = {}) {
    const fieldMap = {
        name: manifestName,
        shortName: manifestShortName,
        id: manifestId,
        description: manifestDescription,
        startUrl: manifestStartUrl,
        scope: manifestScope,
        display: manifestDisplay,
        categories: manifestCategories,
        themeColor: manifestThemeColor,
        backgroundColor: manifestBackgroundColor,
        lang: manifestLang,
        dir: manifestDir,
        shortcuts: manifestShortcuts,
        screenshots: manifestScreenshots
    };
    Object.entries(fieldMap).forEach(([key, field]) => {
        if (Object.prototype.hasOwnProperty.call(values, key)) field.value = String(values[key] ?? '');
    });
    if (Object.prototype.hasOwnProperty.call(values, 'monochrome')) {
        manifestMonochrome.checked = Boolean(values.monochrome);
    }
    validateManifestMetadata();
}

function setShapeSelection(containerSelector, shape) {
    const nextShape = ['rounded', 'circle', 'square'].includes(shape) ? shape : 'rounded';
    document.querySelectorAll(`${containerSelector} .btn-crop`).forEach(btn => {
        btn.classList.toggle('active', btn.dataset.shape === nextShape);
    });
    return nextShape;
}

function setActivePresetButton(key) {
    activePresetKey = key && PRESETS[key] ? key : null;
    document.querySelectorAll('.btn-preset').forEach(btn => {
        btn.classList.toggle('active', Boolean(activePresetKey && btn.dataset.preset === activePresetKey));
    });
}

function setSelectedSizesFromDraft(sizes = []) {
    const normalized = sizes
        .map(entry => {
            try {
                return normalizeSizeEntry(entry);
            } catch {
                return null;
            }
        })
        .filter(size => size?.width && size?.height);
    normalized.forEach(ensureSizeOption);
    sizeGrid.querySelectorAll('input[type="checkbox"]').forEach(input => {
        const size = { width: parseInt(input.value, 10), height: parseInt(input.dataset.height, 10) || parseInt(input.value, 10) };
        const selected = normalized.some(item => item.width === size.width && item.height === size.height);
        input.checked = selected;
        input.closest('.size-option').classList.toggle('selected', selected);
    });
}

function setSelectedFormatsFromDraft(formats = []) {
    const selected = new Set(formats.filter(format => OUTPUT_FORMATS.includes(format)));
    formatOptions.querySelectorAll('input[type="checkbox"]').forEach(input => {
        const checked = selected.has(input.value);
        input.checked = checked;
        input.closest('.format-option').classList.toggle('selected', checked);
    });
    setElementVisible(svgDarkmodeSection, selected.has('svg'), 'block');
}

function draftByteLength(value) {
    return new TextEncoder().encode(String(value || '')).byteLength;
}

function formatDraftAge(savedAt, nowMs = Date.now()) {
    const ageMs = Math.max(0, nowMs - Date.parse(savedAt));
    if (ageMs < 60000) return 'just now';
    if (ageMs < 60 * 60000) return `${Math.floor(ageMs / 60000)} min ago`;
    if (ageMs < 24 * 60 * 60000) return `${Math.floor(ageMs / (60 * 60000))} hr ago`;
    return `${Math.floor(ageMs / (24 * 60 * 60000))} day${ageMs < 2 * 24 * 60 * 60000 ? '' : 's'} ago`;
}

function draftStorageSummary(draft, raw = JSON.stringify(draft), nowMs = Date.now()) {
    const bytes = draftByteLength(raw);
    const expiresInDays = Math.max(0, Math.ceil((DRAFT_TTL_MS - Math.max(0, nowMs - Date.parse(draft.savedAt))) / (24 * 60 * 60 * 1000)));
    const sourceState = draft.sourceImage ? 'source image included' : 'settings only';
    return `Saved ${formatDraftAge(draft.savedAt, nowMs)} • ${formatFileSize(bytes)} • ${sourceState} • expires in ${expiresInDays} day${expiresInDays === 1 ? '' : 's'}.`;
}

function readDraftPreferences() {
    const storage = draftStorage();
    try {
        const parsed = JSON.parse(storage?.getItem(DRAFT_PREFERENCES_KEY) || 'null');
        return {
            enabled: parsed?.enabled !== false,
            clearOnExport: Boolean(parsed?.clearOnExport)
        };
    } catch {
        return { enabled: true, clearOnExport: false };
    }
}

function saveDraftPreferences() {
    const storage = draftStorage();
    if (!storage) return;
    try {
        storage.setItem(DRAFT_PREFERENCES_KEY, JSON.stringify({
            enabled: Boolean(draftEnabledToggle?.checked),
            clearOnExport: Boolean(draftClearOnExportToggle?.checked)
        }));
    } catch {
        // Preferences are best-effort when storage is unavailable or full.
    }
}

function applyDraftPreferenceControls(preferences = readDraftPreferences()) {
    if (draftEnabledToggle) draftEnabledToggle.checked = preferences.enabled !== false;
    if (draftClearOnExportToggle) draftClearOnExportToggle.checked = Boolean(preferences.clearOnExport);
    const enabled = Boolean(draftEnabledToggle?.checked);
    if (draftSourceToggle) draftSourceToggle.disabled = !enabled;
    if (draftClearOnExportToggle) draftClearOnExportToggle.disabled = !enabled;
    return preferences;
}

function migrateDraftSnapshot(draft) {
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
        return { valid: false, reason: 'Draft data is not an object.' };
    }
    let migrated = false;
    let next = draft;
    if (draft.schema === 'iconforge-draft-v1') {
        next = { ...draft, schema: DRAFT_SCHEMA, migratedFrom: 'iconforge-draft-v1' };
        migrated = true;
    } else if (draft.schema !== DRAFT_SCHEMA) {
        return { valid: false, reason: `Unsupported draft schema "${draft.schema || 'missing'}".` };
    }
    const savedAtMs = Date.parse(next.savedAt);
    if (!Number.isFinite(savedAtMs)) {
        return { valid: false, reason: 'Draft savedAt timestamp is invalid.' };
    }
    if (!next.restoreSourceImage || !next.sourceImage?.dataUrl?.startsWith('data:image/')) {
        next = { ...next, restoreSourceImage: false, sourceImage: null };
    }
    return { valid: true, draft: next, migrated };
}

function inspectDraftRecord(raw, nowMs = Date.now()) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { valid: false, status: 'corrupt', reason: 'Draft JSON is corrupt.' };
    }
    const migration = migrateDraftSnapshot(parsed);
    if (!migration.valid) return { ...migration, status: 'unsupported' };
    const ageMs = nowMs - Date.parse(migration.draft.savedAt);
    if (ageMs > DRAFT_TTL_MS) {
        return { valid: false, status: 'expired', reason: 'Draft is older than 30 days.' };
    }
    let draft = migration.draft;
    let serialized = JSON.stringify(draft);
    let sourceDropped = false;
    if (draftByteLength(serialized) > MAX_DRAFT_BYTES && draft.sourceImage) {
        draft = { ...draft, restoreSourceImage: false, sourceImage: null };
        serialized = JSON.stringify(draft);
        sourceDropped = true;
    }
    if (draftByteLength(serialized) > MAX_DRAFT_BYTES) {
        return { valid: false, status: 'oversized', reason: 'Draft settings exceed the 4 MB storage limit.' };
    }
    return {
        valid: true,
        status: migration.migrated ? 'migrated' : 'ready',
        draft,
        serialized,
        migrated: migration.migrated,
        sourceDropped
    };
}

function buildDraftSnapshot() {
    const sourceImageDraftEnabled = Boolean(draftEnabledToggle?.checked && draftSourceToggle?.checked);
    const sourceImageDraft = sourceImageDraftEnabled && originalImageData && sourceImage ? {
        dataUrl: originalImageData,
        mode: sourceMode,
        name: sourceMode === 'upload' ? 'restored-image' : sourceFileName,
        width: sourceImage.naturalWidth,
        height: sourceImage.naturalHeight
    } : null;

    return {
        schema: DRAFT_SCHEMA,
        version: APP_VERSION,
        savedAt: new Date().toISOString(),
        inputMode: getActiveInputMode(),
        sourceMode,
        restoreSourceImage: sourceImageDraftEnabled,
        sourceImage: sourceImageDraft,
        cropRegion: validDraftCrop(cropRegion),
        selectedSizes: getSelectedSizes(),
        selectedFormats: getSelectedFormats(),
        activePresetKey,
        processing: {
            safePadding: safePaddingSlider.value,
            lossyQuality: lossyQualitySlider.value,
            sizeBudgetKb: sizeBudgetInput.value,
            resample: resampleSelect.value,
            backgroundMode: backgroundMode.value,
            backgroundColor: backgroundColor.value,
            backgroundColor2: backgroundColor2.value,
            effect: effectSelect.value,
            dropShadow: Boolean(dropShadowToggle.checked),
            maskShape: maskShapeSelect.value,
            svgLightColor: svgLightColor.value,
            svgDarkColor: svgDarkColor.value,
            tolerance: toleranceSlider.value
        },
        sourceTools: {
            text: {
                value: textInput.value,
                font: fontSelect.value,
                textColor: textColor.value,
                backgroundColor: textBgColor.value,
                shape: textShape
            },
            emoji: {
                value: selectedEmoji,
                backgroundColor: emojiBgColor.value,
                shape: emojiShape
            }
        },
        deploymentUrls: {
            mode: assetUrlMode.value,
            customBase: assetUrlBase.value,
            cacheBust: Boolean(cacheBustToggle.checked)
        },
        manifestMetadata: manifestDraftValues()
    };
}

function removeStoredDrafts() {
    const storage = draftStorage();
    if (!storage) return;
    storage.removeItem(DRAFT_STORAGE_KEY);
    for (const key of LEGACY_DRAFT_STORAGE_KEYS) storage.removeItem(key);
}

function readDraftSnapshot({ nowMs = Date.now(), reportStatus = true } = {}) {
    if (!draftEnabledToggle?.checked) return null;
    const storage = draftStorage();
    if (!storage) return null;
    let sourceKey = DRAFT_STORAGE_KEY;
    let raw = null;
    try {
        raw = storage.getItem(DRAFT_STORAGE_KEY);
        if (!raw) {
            for (const legacyKey of LEGACY_DRAFT_STORAGE_KEYS) {
                raw = storage.getItem(legacyKey);
                if (raw) {
                    sourceKey = legacyKey;
                    break;
                }
            }
        }
    } catch {
        return null;
    }
    if (!raw) return null;
    const result = inspectDraftRecord(raw, nowMs);
    if (!result.valid) {
        try {
            removeStoredDrafts();
        } catch {
            // The invalid draft remains inaccessible if storage removal fails.
        }
        if (reportStatus) {
            const message = result.status === 'expired'
                ? 'Saved draft expired after 30 days and was cleared.'
                : `Saved draft was not restored and was cleared: ${result.reason}`;
            setDraftStatus(message, 'warning');
        }
        return null;
    }
    if (result.migrated || result.sourceDropped || sourceKey !== DRAFT_STORAGE_KEY) {
        try {
            storage.setItem(DRAFT_STORAGE_KEY, result.serialized);
            for (const key of LEGACY_DRAFT_STORAGE_KEYS) storage.removeItem(key);
        } catch {
            if (reportStatus) setDraftStatus('Draft migration could not be saved.', 'warning');
        }
    }
    return result.draft;
}

function saveDraftState({ silent = false } = {}) {
    if (isRestoringDraft || draftClearedUntilChange || !draftEnabledToggle?.checked) return null;
    const storage = draftStorage();
    if (!storage) return null;
    let snapshot = buildDraftSnapshot();
    let raw = JSON.stringify(snapshot);
    if (draftByteLength(raw) > MAX_DRAFT_BYTES && snapshot.sourceImage) {
        snapshot = { ...snapshot, restoreSourceImage: false, sourceImage: null };
        raw = JSON.stringify(snapshot);
        if (!silent) setDraftStatus('Source image exceeded the 4 MB draft limit; settings were saved without image bytes.', 'warning');
    }
    if (draftByteLength(raw) > MAX_DRAFT_BYTES) {
        if (!silent) setDraftStatus('Draft settings exceed the 4 MB local storage limit.', 'warning');
        return null;
    }
    try {
        storage.setItem(DRAFT_STORAGE_KEY, raw);
        for (const key of LEGACY_DRAFT_STORAGE_KEYS) storage.removeItem(key);
        setDraftStatus(draftStorageSummary(snapshot, raw), 'success');
        return snapshot;
    } catch {
        if (snapshot.sourceImage) {
            snapshot = { ...snapshot, restoreSourceImage: false, sourceImage: null };
            raw = JSON.stringify(snapshot);
            try {
                storage.setItem(DRAFT_STORAGE_KEY, raw);
                if (!silent) setDraftStatus(uiText('draft.tooLarge'), 'warning');
                return snapshot;
            } catch {
                // Fall through to the generic warning.
            }
        }
        if (!silent) setDraftStatus(uiText('draft.saveFailed'), 'warning');
        return null;
    }
}

function queueDraftSave() {
    if (isRestoringDraft || !draftEnabledToggle?.checked) return;
    draftClearedUntilChange = false;
    clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(() => saveDraftState({ silent: true }), 250);
}

function clearDraftState({ suppressAutoSave = true, message = uiText('draft.cleared') } = {}) {
    clearTimeout(draftSaveTimer);
    draftSaveTimer = null;
    const storage = draftStorage();
    try {
        removeStoredDrafts();
    } catch {
        setDraftStatus(uiText('draft.clearFailed'), 'warning');
        return;
    }
    draftClearedUntilChange = suppressAutoSave;
    if (draftSourceToggle) draftSourceToggle.checked = false;
    setDraftStatus(message, 'success');
}

function applyDraftControls(draft) {
    if (!draft) return;
    setInputMode(draft.inputMode || 'upload');
    if (draftSourceToggle) draftSourceToggle.checked = Boolean(draft.restoreSourceImage);

    if (draft.processing) {
        safePaddingSlider.value = draft.processing.safePadding ?? safePaddingSlider.value;
        lossyQualitySlider.value = draft.processing.lossyQuality ?? lossyQualitySlider.value;
        sizeBudgetInput.value = draft.processing.sizeBudgetKb ?? '';
        resampleSelect.value = draft.processing.resample || resampleSelect.value;
        backgroundMode.value = draft.processing.backgroundMode || backgroundMode.value;
        backgroundColor.value = draft.processing.backgroundColor || backgroundColor.value;
        backgroundColor2.value = draft.processing.backgroundColor2 || backgroundColor2.value;
        effectSelect.value = draft.processing.effect || effectSelect.value;
        dropShadowToggle.checked = Boolean(draft.processing.dropShadow);
        maskShapeSelect.value = draft.processing.maskShape || maskShapeSelect.value;
        svgLightColor.value = draft.processing.svgLightColor || svgLightColor.value;
        svgDarkColor.value = draft.processing.svgDarkColor || svgDarkColor.value;
        toleranceSlider.value = draft.processing.tolerance || toleranceSlider.value;
        toleranceValue.textContent = toleranceSlider.value;
        updateProcessingControlLabels();
    }

    if (draft.sourceTools?.text) {
        textInput.value = draft.sourceTools.text.value ?? textInput.value;
        fontSelect.value = draft.sourceTools.text.font || fontSelect.value;
        textColor.value = draft.sourceTools.text.textColor || textColor.value;
        textBgColor.value = draft.sourceTools.text.backgroundColor || textBgColor.value;
        textShape = setShapeSelection('#shapeOptions', draft.sourceTools.text.shape);
        renderTextPreview();
    }

    if (draft.sourceTools?.emoji) {
        selectedEmoji = draft.sourceTools.emoji.value || selectedEmoji;
        emojiBgColor.value = draft.sourceTools.emoji.backgroundColor || emojiBgColor.value;
        emojiShape = setShapeSelection('#emojiShapeOptions', draft.sourceTools.emoji.shape);
        emojiGrid.querySelectorAll('.emoji-btn').forEach(btn => {
            btn.classList.toggle('selected', btn.textContent === selectedEmoji);
        });
        renderEmojiPreview();
    }

    if (draft.deploymentUrls) {
        assetUrlMode.value = draft.deploymentUrls.mode || assetUrlMode.value;
        assetUrlBase.value = draft.deploymentUrls.customBase ?? assetUrlBase.value;
        cacheBustToggle.checked = Boolean(draft.deploymentUrls.cacheBust);
        validateDeploymentUrlOptions();
    }

    if (draft.manifestMetadata) applyManifestDraftValues(draft.manifestMetadata);
    setActivePresetButton(draft.activePresetKey);
    setSelectedSizesFromDraft(draft.selectedSizes || []);
    setSelectedFormatsFromDraft(draft.selectedFormats || []);
    updateMaskPreview();
}

async function restoreDraftSourceImage(draft) {
    if (!draft?.restoreSourceImage || !draft.sourceImage?.dataUrl) return false;
    try {
        const img = await loadImageElement(draft.sourceImage.dataUrl);
        sourceImage = img;
        sourceFileName = draft.sourceImage.name || 'restored-image';
        sourceMode = draft.sourceImage.mode || 'upload';
        originalImageData = draft.sourceImage.dataUrl;
        previewImage.src = originalImageData;
        setPreviewInfo(sourceFileName, img.naturalWidth, img.naturalHeight, 'restored draft');
        setElementVisible(dropZone, false);
        previewContainer.classList.add('active');
        btnGenerate.disabled = false;
        setElementVisible(outputSection, false);
        cropSection.classList.add('active');
        cropRegion = validDraftCrop(draft.cropRegion, img);
        currentCropRect = null;
        isManualCropMode = false;
        btnManualCrop.classList.remove('active');
        setElementVisible(btnApplyCrop, false);
        initCropCanvas();
        if (cropRegion) updatePreviewWithCrop();
        updateMaskPreview();
        return true;
    } catch {
        setDraftStatus(uiText('draft.sourceLoadFailed'), 'warning');
        return false;
    }
}

async function restoreDraftState() {
    const draft = readDraftSnapshot();
    if (!draft) {
        if (!draftEnabledToggle?.checked) setDraftStatus('Draft recovery is disabled. Nothing will be saved locally.', '');
        return;
    }
    isRestoringDraft = true;
    try {
        applyDraftControls(draft);
        const sourceRestored = await restoreDraftSourceImage(draft);
        const restoredMessage = sourceRestored
            ? uiText('draft.restoredWithSource')
            : uiText('draft.restoredSettings');
        setDraftStatus(`${restoredMessage} ${draftStorageSummary(draft)}`, sourceRestored ? 'success' : '');
    } catch {
        try {
            removeStoredDrafts();
        } catch {
            // Keep the recovery warning even if storage cleanup fails.
        }
        setDraftStatus(uiText('draft.broken'), 'warning');
    } finally {
        isRestoringDraft = false;
    }
}

function clearDraftAfterExportIfRequested() {
    if (!draftEnabledToggle?.checked || !draftClearOnExportToggle?.checked) return false;
    clearDraftState({ suppressAutoSave: true, message: 'Saved draft cleared after export.' });
    return true;
}

function createGenerationStats() {
    return {
        workerJobs: 0,
        canvasFallbacks: 0,
        fallbackReasons: []
    };
}

function noteWorkerJob() {
    generationStats.workerJobs += 1;
}

function noteCanvasFallback(reason) {
    generationStats.canvasFallbacks += 1;
    if (reason && !generationStats.fallbackReasons.includes(reason)) {
        generationStats.fallbackReasons.push(reason);
    }
}

function formatLabel(format) {
    return FORMAT_LABELS[format] || format.toUpperCase();
}

function supportCheck(label, supported, detailSupported, detailUnsupported, pending = false) {
    if (pending) {
        return { label, status: 'info', detail: uiText('diagnostics.pending') };
    }
    return {
        label,
        status: supported ? 'pass' : 'warn',
        detail: supported ? detailSupported : detailUnsupported
    };
}

function getFeatureDiagnostics() {
    const features = UI_STRINGS.diagnostics.features;
    return [
        supportCheck(
            features.webp[0],
            featureSupport.webpEncode,
            features.webp[1],
            features.webp[2],
            !featureSupport.webpChecked
        ),
        supportCheck(
            features.avif[0],
            featureSupport.avifEncode,
            features.avif[1],
            features.avif[2],
            !featureSupport.avifChecked
        ),
        supportCheck(
            features.fileSystemAccess[0],
            featureSupport.fileSystemAccess,
            features.fileSystemAccess[1],
            features.fileSystemAccess[2]
        ),
        supportCheck(
            features.fileHandling[0],
            featureSupport.fileHandling,
            features.fileHandling[1],
            features.fileHandling[2]
        ),
        supportCheck(
            features.offscreenCanvas[0],
            featureSupport.offscreenCanvas,
            features.offscreenCanvas[1],
            features.offscreenCanvas[2]
        ),
        supportCheck(
            features.blobWorker[0],
            featureSupport.workerApi && featureSupport.blobWorker,
            features.blobWorker[1],
            featureSupport.workerApi ? features.blobWorker[2] : features.workerApiUnavailable
        )
    ];
}

function getSkippedFormatDiagnostics(selectedFormats) {
    const selected = new Set(selectedFormats);
    return OUTPUT_FORMATS
        .filter(format => !selected.has(format))
        .map(format => {
            if (format === 'webp') {
                if (!featureSupport.webpChecked) return 'WebP pending encoder check';
                if (!featureSupport.webpEncode) return 'WebP hidden: encoder unsupported';
            }
            if (format === 'avif') {
                if (!featureSupport.avifChecked) return 'AVIF pending encoder check';
                if (!featureSupport.avifEncode) return 'AVIF hidden: encoder unsupported';
            }
            return `${formatLabel(format)} skipped`;
        });
}

function getWorkerDiagnostics() {
    const reasons = generationStats.fallbackReasons.join('; ');
    if (generationStats.workerJobs > 0 && generationStats.canvasFallbacks > 0) {
        return `Worker used for ${generationStats.workerJobs}; canvas fallback for ${generationStats.canvasFallbacks}${reasons ? ` (${reasons})` : ''}`;
    }
    if (generationStats.workerJobs > 0) {
        return `Worker path used for ${generationStats.workerJobs} resize${generationStats.workerJobs === 1 ? '' : 's'}`;
    }
    if (generationStats.canvasFallbacks > 0) {
        return `Canvas fallback for ${generationStats.canvasFallbacks} resize${generationStats.canvasFallbacks === 1 ? '' : 's'}${reasons ? ` (${reasons})` : ''}`;
    }
    if (!featureSupport.workerApi) return 'Canvas fallback: Worker API unavailable';
    if (!featureSupport.offscreenCanvas) return 'Canvas fallback: OffscreenCanvas unavailable';
    if (!featureSupport.blobWorker) return 'Canvas fallback: blob worker unavailable';
    return 'Worker available; no eligible image resizes in this export';
}

function buildGenerationDiagnostics({ selectedFormats = getSelectedFormats(), validationResult = null, error = null } = {}) {
    const totalBytes = generatedFiles.reduce((sum, file) => sum + (file.blob?.size || 0), 0);
    const skippedFormats = getSkippedFormatDiagnostics(selectedFormats);
    const selectedFormatText = selectedFormats.length ? selectedFormats.map(formatLabel).join(', ') : 'None';
    const validationStatus = error ? 'Not run' : validationResult?.title || 'Not run';
    const fileCountText = `${generatedFiles.length} file${generatedFiles.length === 1 ? '' : 's'}`;
    const metricLabels = UI_STRINGS.diagnostics.metrics;

    return {
        title: error ? uiText('diagnostics.failedTitle') : uiText('diagnostics.title'),
        detail: error ? error.message : uiText('diagnostics.detail', { count: fileCountText, preset: PRESET_LABELS[activePresetKey] || 'Custom' }),
        metrics: [
            { label: metricLabels.selectedPreset, value: PRESET_LABELS[activePresetKey] || 'Custom' },
            { label: metricLabels.selectedFormats, value: selectedFormatText },
            { label: metricLabels.skippedFormats, value: skippedFormats.length ? skippedFormats.join('; ') : 'None' },
            { label: metricLabels.workerFallback, value: getWorkerDiagnostics() },
            { label: metricLabels.lossyQuality, value: `${getLossyQualityPercent()}% for JPG/WebP/AVIF` },
            { label: metricLabels.sizeBudget, value: getSizeBudgetStatus(totalBytes) },
            { label: metricLabels.generatedFileCount, value: String(generatedFiles.length) },
            { label: metricLabels.totalBytes, value: totalBytes ? formatFileSize(totalBytes) : '0 B' },
            { label: metricLabels.validationStatus, value: validationStatus }
        ],
        features: getFeatureDiagnostics()
    };
}

function getBrowserEnvironmentDiagnostics() {
    const nav = typeof navigator !== 'undefined' ? navigator : {};
    return {
        userAgent: nav.userAgent || null,
        language: nav.language || null,
        platform: nav.platform || null,
        online: typeof nav.onLine === 'boolean' ? nav.onLine : null
    };
}

function getFeatureSupportSnapshot() {
    return {
        webpEncode: featureSupport.webpEncode,
        webpChecked: featureSupport.webpChecked,
        avifEncode: featureSupport.avifEncode,
        avifChecked: featureSupport.avifChecked,
        fileSystemAccess: featureSupport.fileSystemAccess,
        fileHandling: featureSupport.fileHandling,
        offscreenCanvas: featureSupport.offscreenCanvas,
        workerApi: featureSupport.workerApi,
        blobWorker: featureSupport.blobWorker
    };
}

function diagnosticsFileRecord(file) {
    return {
        name: normalizedFileName(file.name),
        format: file.format || null,
        role: file.role || file.purpose || null,
        dimensions: dimensionsForFile(file),
        mimeType: mimeTypeForFile(file),
        byteSize: file.blob?.size || 0
    };
}

function buildDiagnosticsSupportReport({ selectedFormats = getSelectedFormats(), validationResult = null, error = null, diagnostics = null } = {}) {
    const metrics = diagnostics || buildGenerationDiagnostics({ selectedFormats, validationResult, error });
    const totalBytes = generatedFiles.reduce((sum, file) => sum + (file.blob?.size || 0), 0);
    return {
        schema: 'iconforge-diagnostics-v1',
        createdAt: new Date().toISOString(),
        app: {
            name: 'IconForge',
            version: APP_VERSION
        },
        browser: getBrowserEnvironmentDiagnostics(),
        browserSupport: {
            flags: getFeatureSupportSnapshot(),
            checks: metrics.features
        },
        preset: {
            key: activePresetKey || 'custom',
            label: PRESET_LABELS[activePresetKey] || 'Custom'
        },
        selectedFormats: [...selectedFormats],
        selectedSizes: getSelectedSizes(),
        generation: {
            fileCount: generatedFiles.length,
            totalBytes,
            workerFallbackState: getWorkerDiagnostics(),
            workerJobs: generationStats.workerJobs,
            canvasFallbacks: generationStats.canvasFallbacks,
            fallbackReasons: [...generationStats.fallbackReasons],
            lossyQualityPercent: getLossyQualityPercent(),
            sizeBudgetBytes: getSizeBudgetBytes()
        },
        validation: validationResult ? {
            status: validationResult.status,
            title: validationResult.title,
            checks: validationResult.checks
        } : {
            status: error ? 'error' : 'not-run',
            title: error ? 'Not run after generation error' : 'Not run',
            checks: []
        },
        encoderErrors: error ? [{
            name: error.name || 'Error',
            message: error.message || String(error)
        }] : [],
        visibleDiagnostics: {
            title: metrics.title,
            detail: metrics.detail,
            metrics: metrics.metrics,
            features: metrics.features
        },
        generatedFileMetadata: generatedFiles.map(diagnosticsFileRecord)
    };
}

function diagnosticsSupportJson() {
    const report = latestDiagnosticsSupportReport || buildDiagnosticsSupportReport();
    return JSON.stringify(report, null, 2);
}

function appendMetric(container, label, value) {
    const item = document.createElement('div');
    item.className = 'diagnostics-metric';
    const labelEl = document.createElement('span');
    labelEl.textContent = label;
    const valueEl = document.createElement('strong');
    valueEl.textContent = value;
    item.appendChild(labelEl);
    item.appendChild(valueEl);
    container.appendChild(item);
}

function appendFeature(container, feature) {
    const item = document.createElement('li');
    item.className = 'diagnostics-item';
    const dot = document.createElement('span');
    dot.className = `diagnostics-state ${feature.status}`;
    const body = document.createElement('span');
    const label = document.createElement('strong');
    label.textContent = feature.label;
    body.appendChild(label);
    body.appendChild(document.createTextNode(feature.detail));
    item.appendChild(dot);
    item.appendChild(body);
    container.appendChild(item);
}

function renderGenerationDiagnostics(options = {}) {
    if (!diagnosticsSection || !diagnosticsSummary || !diagnosticsGrid || !diagnosticsFeatureList) return null;
    const selectedFormats = options.selectedFormats || getSelectedFormats();
    const diagnostics = buildGenerationDiagnostics({ ...options, selectedFormats });
    latestDiagnosticsSupportReport = buildDiagnosticsSupportReport({
        ...options,
        selectedFormats,
        diagnostics
    });

    setElementVisible(diagnosticsSection, true, 'block');
    diagnosticsSummary.textContent = '';
    const title = document.createElement('strong');
    title.textContent = diagnostics.title;
    const detail = document.createElement('span');
    detail.textContent = diagnostics.detail;
    diagnosticsSummary.appendChild(title);
    diagnosticsSummary.appendChild(detail);

    diagnosticsGrid.textContent = '';
    diagnostics.metrics.forEach(metric => appendMetric(diagnosticsGrid, metric.label, metric.value));

    diagnosticsFeatureList.textContent = '';
    diagnostics.features.forEach(feature => appendFeature(diagnosticsFeatureList, feature));
    return diagnostics;
}

function drawShapeBg(ctx, size, shape, color) {
    ctx.fillStyle = color;
    if (shape === 'circle') {
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
        ctx.fill();
    } else if (shape === 'rounded') {
        ctx.beginPath();
        ctx.roundRect(0, 0, size, size, size * 0.2);
        ctx.fill();
    } else {
        ctx.fillRect(0, 0, size, size);
    }
}

function normalizeSizeEntry(entry) {
    if (typeof entry === 'number') return { width: entry, height: entry };
    return { width: entry.width, height: entry.height || entry.width };
}

function sizeKey(size) {
    return `${size.width}x${size.height}`;
}

function cleanPathSegment(value) {
    return (value || 'icon')
        .toString()
        .trim()
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'icon';
}

function baseName(path) {
    return path.split(/[\\/]/).pop();
}

function normalizeTemplateName(path) {
    return path.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
}

function clampNumber(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function getLossyQualityPercent() {
    return Math.round(clampNumber(lossyQualitySlider?.value, 40, 100, 92));
}

function getLossyQuality() {
    return getLossyQualityPercent() / 100;
}

function getSizeBudgetBytes() {
    const kb = clampNumber(sizeBudgetInput?.value, 0, 102400, 0);
    return kb > 0 ? Math.round(kb * 1024) : null;
}

function getSizeBudgetStatus(totalBytes) {
    const budgetBytes = getSizeBudgetBytes();
    if (!budgetBytes) return 'Not set';
    const delta = Math.abs(totalBytes - budgetBytes);
    return totalBytes > budgetBytes
        ? `${formatFileSize(totalBytes)} total, ${formatFileSize(delta)} over ${formatFileSize(budgetBytes)} budget`
        : `${formatFileSize(totalBytes)} total, ${formatFileSize(delta)} under ${formatFileSize(budgetBytes)} budget`;
}

function getProcessingOptions(overrides = {}) {
    const options = {
        paddingPercent: parseInt(safePaddingSlider.value, 10) || 0,
        resample: resampleSelect.value,
        backgroundMode: backgroundMode.value,
        backgroundColor: backgroundColor.value,
        backgroundColor2: backgroundColor2.value,
        effect: effectSelect.value,
        dropShadow: dropShadowToggle.checked
    };
    return { ...options, ...overrides };
}

function usesCustomProcessing(options) {
    return options.paddingPercent > 0 ||
        options.backgroundMode !== 'transparent' ||
        options.effect !== 'none' ||
        options.dropShadow ||
        options.resample !== 'auto';
}

function fillIconBackground(ctx, width, height, options, forceFill = false) {
    if (options.backgroundMode === 'transparent' && !forceFill) return;
    if (options.backgroundMode === 'gradient') {
        const grad = ctx.createLinearGradient(0, 0, width, height);
        grad.addColorStop(0, options.backgroundColor);
        grad.addColorStop(1, options.backgroundColor2);
        ctx.fillStyle = grad;
    } else {
        ctx.fillStyle = options.backgroundMode === 'transparent'
            ? options.backgroundColor
            : options.backgroundColor;
    }
    ctx.fillRect(0, 0, width, height);
}

function drawIconToContext(ctx, img, width, height, crop = null, options = getProcessingOptions()) {
    ctx.clearRect(0, 0, width, height);
    const srcX = crop ? crop.x : 0;
    const srcY = crop ? crop.y : 0;
    const srcW = crop ? crop.width : img.naturalWidth;
    const srcH = crop ? crop.height : img.naturalHeight;
    const padding = Math.max(0, Math.min(0.45, (options.paddingPercent || 0) / 100));
    const drawW = width * (1 - padding * 2);
    const drawH = height * (1 - padding * 2);
    const scale = Math.min(drawW / srcW, drawH / srcH);
    let scaledWidth = srcW * scale;
    let scaledHeight = srcH * scale;
    let x = (width - scaledWidth) / 2;
    let y = (height - scaledHeight) / 2;
    const shouldHint = options.resample === 'hinted' || (options.resample === 'auto' && width <= 32 && height <= 32);

    fillIconBackground(ctx, width, height, options);

    ctx.imageSmoothingEnabled = options.resample !== 'nearest';
    ctx.imageSmoothingQuality = options.resample === 'nearest' ? 'low' : 'high';

    if (shouldHint) {
        x = Math.round(x);
        y = Math.round(y);
        scaledWidth = Math.max(1, Math.round(scaledWidth));
        scaledHeight = Math.max(1, Math.round(scaledHeight));
    }

    ctx.save();
    if (options.dropShadow) {
        ctx.shadowColor = 'rgba(0,0,0,0.42)';
        ctx.shadowBlur = Math.max(3, width * 0.045);
        ctx.shadowOffsetY = Math.max(1, width * 0.018);
    }
    if (options.effect === 'desaturate') {
        ctx.filter = 'saturate(0.45) contrast(1.05)';
    }
    ctx.drawImage(img, srcX, srcY, srcW, srcH, x, y, scaledWidth, scaledHeight);
    ctx.restore();

    if (options.effect === 'tint') {
        ctx.save();
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = `${options.backgroundColor2}88`;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
    } else if (options.effect === 'glass') {
        ctx.save();
        ctx.globalCompositeOperation = 'source-atop';
        const shine = ctx.createLinearGradient(0, 0, width, height);
        shine.addColorStop(0, 'rgba(255,255,255,0.36)');
        shine.addColorStop(0.44, 'rgba(255,255,255,0.08)');
        shine.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = shine;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
    }
}

function drawMaskOutline(ctx, width, height, shape) {
    const pad = width * 0.08;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.88)';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    if (shape === 'circle') {
        ctx.beginPath();
        ctx.arc(width / 2, height / 2, Math.min(width, height) * 0.42, 0, Math.PI * 2);
        ctx.stroke();
    } else if (shape === 'squircle') {
        ctx.beginPath();
        ctx.roundRect(pad, pad, width - pad * 2, height - pad * 2, width * 0.22);
        ctx.stroke();
    } else {
        ctx.strokeRect(pad, pad, width - pad * 2, height - pad * 2);
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(34,197,94,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, width * 0.32, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
}

function updateMaskPreview() {
    const width = maskPreviewCanvas.width;
    const height = maskPreviewCanvas.height;
    maskPreviewCtx.clearRect(0, 0, width, height);
    if (!sourceImage) {
        maskPreviewCtx.fillStyle = '#131316';
        maskPreviewCtx.fillRect(0, 0, width, height);
        return;
    }
    const options = getProcessingOptions({
        paddingPercent: Math.max(parseInt(safePaddingSlider.value, 10) || 0, 10)
    });
    drawIconToContext(maskPreviewCtx, sourceImage, width, height, cropRegion, options);
    drawMaskOutline(maskPreviewCtx, width, height, maskShapeSelect.value);
}

function switchToUploadMode() {
    setInputMode('upload');
}

// Input mode tabs
const uploadMode = document.getElementById('uploadMode');
const textMode = document.getElementById('textMode');
const emojiMode = document.getElementById('emojiMode');

function getActiveInputMode() {
    return document.querySelector('.mode-tab.active')?.dataset.mode || 'upload';
}

function setInputMode(mode) {
    const nextMode = ['upload', 'text', 'emoji'].includes(mode) ? mode : 'upload';
    document.querySelectorAll('.mode-tab').forEach(tab => {
        const selected = tab.dataset.mode === nextMode;
        tab.classList.toggle('active', selected);
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
    });
    setElementVisible(uploadMode, nextMode === 'upload');
    setElementVisible(textMode, nextMode === 'text');
    setElementVisible(emojiMode, nextMode === 'emoji');
    if (nextMode === 'text') renderTextPreview();
    if (nextMode === 'emoji') renderEmojiPreview();
}

document.querySelector('.input-mode-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.mode-tab');
    if (!tab) return;
    setInputMode(tab.dataset.mode);
    queueDraftSave();
});
document.querySelector('.input-mode-tabs').addEventListener('keydown', (event) => {
    const tab = event.target.closest('.mode-tab');
    if (!tab) return;
    const tabs = Array.from(document.querySelectorAll('.mode-tab'));
    const currentIndex = tabs.indexOf(tab);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    const nextTab = tabs[nextIndex];
    setInputMode(nextTab.dataset.mode);
    nextTab.focus();
    queueDraftSave();
});

// Text-to-favicon
const textPreviewCanvas = document.getElementById('textPreviewCanvas');
const textPreviewCtx = textPreviewCanvas.getContext('2d');
const textInput = document.getElementById('textInput');
const fontSelect = document.getElementById('fontSelect');
const textColor = document.getElementById('textColor');
const textBgColor = document.getElementById('textBgColor');
let textShape = 'rounded';

document.getElementById('shapeOptions').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-shape]');
    if (!btn) return;
    document.querySelectorAll('#shapeOptions .btn-crop').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    textShape = btn.dataset.shape;
    renderTextPreview();
    queueDraftSave();
});

[textInput, fontSelect, textColor, textBgColor].forEach(el => {
    el.addEventListener('input', () => {
        renderTextPreview();
        queueDraftSave();
    });
});

function renderTextPreview() {
    const size = 256;
    textPreviewCanvas.width = size;
    textPreviewCanvas.height = size;
    const ctx = textPreviewCtx;
    const letter = textInput.value || 'A';

    ctx.clearRect(0, 0, size, size);
    drawShapeBg(ctx, size, textShape, textBgColor.value);

    ctx.fillStyle = textColor.value;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const fontSize = letter.length === 1 ? size * 0.6 : letter.length === 2 ? size * 0.45 : size * 0.35;
    ctx.font = `bold ${fontSize}px ${fontSelect.value}`;
    ctx.fillText(letter, size / 2, size / 2 + fontSize * 0.04);
}

document.getElementById('btnUseTextIcon').addEventListener('click', () => {
    renderTextPreview();
    const img = new Image();
    img.onload = () => {
        sourceImage = img;
        sourceFileName = `icon-${textInput.value || 'A'}`;
        sourceMode = 'text';
        originalImageData = textPreviewCanvas.toDataURL('image/png');
        previewImage.src = originalImageData;
        setPreviewInfo(sourceFileName, 256, 256, 'text');

        switchToUploadMode();
        setElementVisible(dropZone, false);
        previewContainer.classList.add('active');
        btnGenerate.disabled = false;
        setElementVisible(outputSection, false);
        showStatus('', '');
        cropSection.classList.add('active');
        cropRegion = null;
        initCropCanvas();
        updateMaskPreview();
        saveDraftState({ silent: true });
    };
    img.src = textPreviewCanvas.toDataURL('image/png');
});

renderTextPreview();

// Emoji-to-favicon
const EMOJIS = ['🔥','⚡','🚀','💎','🎯','🎨','🔒','🌟','💡','🎵','🎮','🏆','💬','📦','🔧','⚙️',
    '🌍','🌈','❤️','🍕','☕','🎲','🐱','🐶','🦊','🐸','🌸','🌺','🍀','🎄','⭐','🌙',
    '✨','🎁','🎪','🛡️','⚔️','🏠','🔔','📱','💻','🖥️','📊','📈','🎓','📚','✏️','🔍',
    '🗂️','📋','🎤','🎸','🎹','🎬','📷','🖼️','🧩','🏗️','🚗','✈️','🚢','🏔️','🌊','🔮'];

const emojiGrid = document.getElementById('emojiGrid');
let selectedEmoji = '🔥';

EMOJIS.forEach(em => {
    const btn = document.createElement('button');
    btn.className = 'emoji-btn' + (em === selectedEmoji ? ' selected' : '');
    btn.textContent = em;
    btn.setAttribute('aria-label', `Select emoji ${em}`);
        btn.addEventListener('click', () => {
            emojiGrid.querySelectorAll('.emoji-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            selectedEmoji = em;
            renderEmojiPreview();
            queueDraftSave();
        });
    emojiGrid.appendChild(btn);
});

const emojiPreviewCanvas = document.getElementById('emojiPreviewCanvas');
const emojiPreviewCtx = emojiPreviewCanvas.getContext('2d');
const emojiBgColor = document.getElementById('emojiBgColor');
let emojiShape = 'rounded';

document.getElementById('emojiShapeOptions').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-shape]');
    if (!btn) return;
    document.querySelectorAll('#emojiShapeOptions .btn-crop').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    emojiShape = btn.dataset.shape;
    renderEmojiPreview();
    queueDraftSave();
});

emojiBgColor.addEventListener('input', () => {
    renderEmojiPreview();
    queueDraftSave();
});

function renderEmojiPreview() {
    const size = 256;
    emojiPreviewCanvas.width = size;
    emojiPreviewCanvas.height = size;
    const ctx = emojiPreviewCtx;

    ctx.clearRect(0, 0, size, size);
    drawShapeBg(ctx, size, emojiShape, emojiBgColor.value);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${size * 0.65}px serif`;
    ctx.fillText(selectedEmoji, size / 2, size / 2 + size * 0.03);
}

document.getElementById('btnUseEmojiIcon').addEventListener('click', () => {
    renderEmojiPreview();
    const img = new Image();
    img.onload = () => {
        sourceImage = img;
        sourceFileName = `icon-emoji`;
        sourceMode = 'emoji';
        originalImageData = emojiPreviewCanvas.toDataURL('image/png');
        previewImage.src = originalImageData;
        setPreviewInfo('emoji icon', 256, 256, 'emoji');

        switchToUploadMode();
        setElementVisible(dropZone, false);
        previewContainer.classList.add('active');
        btnGenerate.disabled = false;
        setElementVisible(outputSection, false);
        showStatus('', '');
        cropSection.classList.add('active');
        cropRegion = null;
        initCropCanvas();
        updateMaskPreview();
        saveDraftState({ silent: true });
    };
    img.src = emojiPreviewCanvas.toDataURL('image/png');
});

renderEmojiPreview();

// Clipboard paste support
document.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
        if (item.type.startsWith('image/')) {
            e.preventDefault();
            const file = item.getAsFile();
            if (file) loadImage(file);
            return;
        }
    }
});

// Event Listeners
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fileInput.click();
    }
});
dropZone.addEventListener('dragover', handleDragOver);
dropZone.addEventListener('dragleave', handleDragLeave);
dropZone.addEventListener('drop', handleDrop);
fileInput.addEventListener('change', handleFileSelect);
btnChange.addEventListener('click', resetInput);
btnAddSize.addEventListener('click', addCustomSize);
btnGenerate.addEventListener('click', generateIcons);
btnCancelOperation?.addEventListener('click', cancelActiveOperation);
btnDownloadAll.addEventListener('click', downloadAll);
draftEnabledToggle?.addEventListener('change', () => {
    applyDraftPreferenceControls({
        enabled: draftEnabledToggle.checked,
        clearOnExport: Boolean(draftClearOnExportToggle?.checked)
    });
    saveDraftPreferences();
    if (!draftEnabledToggle.checked) {
        clearDraftState({ suppressAutoSave: true, message: 'Draft recovery disabled and saved draft cleared.' });
        return;
    }
    draftClearedUntilChange = false;
    saveDraftState({ silent: false });
});
draftSourceToggle?.addEventListener('change', () => {
    draftClearedUntilChange = false;
    saveDraftState({ silent: false });
});
draftClearOnExportToggle?.addEventListener('change', saveDraftPreferences);
btnClearDraft?.addEventListener('click', clearDraftState);
btnCopyDiagnostics?.addEventListener('click', async function() {
    try {
        await navigator.clipboard.writeText(diagnosticsSupportJson());
        showCopyFeedback(this);
        showStatus(uiText('status.diagnosticsCopied'), 'success');
    } catch {
        showStatus(uiText('status.diagnosticsCopyFailed'), 'error');
    }
});
btnDownloadDiagnostics?.addEventListener('click', function() {
    try {
        const blob = new Blob([diagnosticsSupportJson()], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'iconforge-diagnostics.json';
        link.click();
        URL.revokeObjectURL(url);
        showStatus(uiText('status.diagnosticsDownloaded'), 'success');
    } catch (error) {
        showStatus(uiText('status.diagnosticsDownloadFailed', { message: error.message }), 'error');
    }
});
function updateProcessingControlLabels() {
    safePaddingValue.textContent = `${safePaddingSlider.value}%`;
    lossyQualityValue.textContent = `${getLossyQualityPercent()}%`;
}

[safePaddingSlider, lossyQualitySlider, sizeBudgetInput, resampleSelect, backgroundMode, backgroundColor, backgroundColor2, svgLightColor, svgDarkColor, effectSelect, dropShadowToggle, maskShapeSelect].forEach(el => {
    el.addEventListener('input', () => {
        updateProcessingControlLabels();
        updateMaskPreview();
        queueDraftSave();
    });
    el.addEventListener('change', () => {
        updateProcessingControlLabels();
        updateMaskPreview();
        queueDraftSave();
    });
});
updateProcessingControlLabels();
replaceInput.addEventListener('change', handleReplacementTemplate);

if ('showDirectoryPicker' in window) {
    setElementVisible(btnSaveToFolder, true);
    btnSaveToFolder.addEventListener('click', saveToFolder);
}

function getHandoffTabMeta(key) {
    return HANDOFF_SNIPPET_TABS.find(tab => tab.key === key) || null;
}

function activateHandoffSnippetTab(key, focusTab = false) {
    if (!getHandoffTabMeta(key)) return;
    activeHandoffSnippetKey = key;
    renderHandoffSnippetTabs();
    if (focusTab) {
        handoffTabs?.querySelector(`[data-handoff-tab="${key}"]`)?.focus();
    }
}

handoffTabs?.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-handoff-tab]');
    if (!tab) return;
    activateHandoffSnippetTab(tab.dataset.handoffTab);
});

handoffTabs?.addEventListener('keydown', (e) => {
    const currentTab = e.target.closest('[data-handoff-tab]');
    if (!currentTab) return;
    const currentIndex = HANDOFF_SNIPPET_TABS.findIndex(tab => tab.key === currentTab.dataset.handoffTab);
    if (currentIndex === -1) return;

    let nextIndex = null;
    if (e.key === 'ArrowRight') nextIndex = (currentIndex + 1) % HANDOFF_SNIPPET_TABS.length;
    if (e.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + HANDOFF_SNIPPET_TABS.length) % HANDOFF_SNIPPET_TABS.length;
    if (e.key === 'Home') nextIndex = 0;
    if (e.key === 'End') nextIndex = HANDOFF_SNIPPET_TABS.length - 1;
    if (nextIndex === null) return;

    e.preventDefault();
    activateHandoffSnippetTab(HANDOFF_SNIPPET_TABS[nextIndex].key, true);
});

// Preset buttons
const PRESETS = {
    web:       { sizes: [16, 32, 48, 180, 192, 512], formats: ['png', 'ico', 'svg'] },
    pwa:       { sizes: [72, 96, 128, 144, 152, 192, 384, 512], formats: ['png'] },
    extension: { sizes: [16, 32, 48, 128], formats: ['png'] },
    android:   { sizes: [192, 512], formats: ['png'] },
    ios:       { sizes: [180, 512], formats: ['png'] },
    windows:   { sizes: [70, 150, 310, { width: 310, height: 150 }], formats: ['png', 'ico'] },
    social:    { sizes: [{ width: 1200, height: 630 }, { width: 1200, height: 675 }, { width: 1200, height: 627 }], formats: ['png'] },
    all:       { sizes: [16, 32, 48, 64, 72, 96, 128, 144, 152, 180, 192, 384, 512], formats: ['png', 'ico', 'svg'] }
};

document.getElementById('presetButtons').addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-preset');
    if (!btn) return;
    const preset = PRESETS[btn.dataset.preset];
    if (!preset) return;

    activePresetKey = btn.dataset.preset;
    document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const presetSizes = preset.sizes.map(normalizeSizeEntry);
    presetSizes.forEach(ensureSizeOption);

    sizeGrid.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        const size = { width: parseInt(cb.value, 10), height: parseInt(cb.dataset.height, 10) || parseInt(cb.value, 10) };
        const match = presetSizes.some(s => s.width === size.width && s.height === size.height);
        cb.checked = match;
        cb.closest('.size-option').classList.toggle('selected', match);
    });

    formatOptions.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        const match = preset.formats.includes(cb.value);
        cb.checked = match;
        cb.closest('.format-option').classList.toggle('selected', match);
    });

    setElementVisible(svgDarkmodeSection, preset.formats.includes('svg'), 'block');
    updateMaskPreview();
    saveDraftState({ silent: true });
});

// Crop Event Listeners
btnAutoCrop.addEventListener('click', performAutoCrop);
btnManualCrop.addEventListener('click', toggleManualCropMode);
btnResetCrop.addEventListener('click', resetCrop);
btnApplyCrop.addEventListener('click', applyCrop);
toleranceSlider.addEventListener('input', (e) => {
    toleranceValue.textContent = e.target.value;
    queueDraftSave();
});

// Canvas crop interaction
cropCanvas.addEventListener('mousedown', startCropDrag);
cropCanvas.addEventListener('mousemove', updateCropDrag);
cropCanvas.addEventListener('mouseup', endCropDrag);
cropCanvas.addEventListener('mouseleave', endCropDrag);

// Touch support for mobile
cropCanvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    startCropDrag({ clientX: touch.clientX, clientY: touch.clientY });
});
cropCanvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    updateCropDrag({ clientX: touch.clientX, clientY: touch.clientY });
});
cropCanvas.addEventListener('touchend', endCropDrag);

// Numeric crop input handler
btnApplyNumericCrop.addEventListener('click', applyNumericCrop);

// Size option toggles
sizeGrid.addEventListener('change', (e) => {
    if (e.target.type === 'checkbox') {
        e.target.closest('.size-option').classList.toggle('selected', e.target.checked);
        queueDraftSave();
    }
});

// Format option toggles
const svgDarkmodeSection = document.getElementById('svgDarkmodeSection');
formatOptions.addEventListener('change', (e) => {
    if (e.target.type === 'checkbox') {
        e.target.closest('.format-option').classList.toggle('selected', e.target.checked);
    }
    const svgChecked = formatOptions.querySelector('input[value="svg"]')?.checked;
    setElementVisible(svgDarkmodeSection, svgChecked, 'block');
    queueDraftSave();
});

// Drag and Drop handlers
function handleDragOver(e) {
    e.preventDefault();
    dropZone.classList.add('drag-over');
}

function handleDragLeave(e) {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
}

function handleDrop(e) {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        loadImage(files[0]);
    }
}

function handleFileSelect(e) {
    if (e.target.files.length > 0) {
        loadImage(e.target.files[0]);
    }
}

async function handleReplacementTemplate(e) {
    replacementTargetNames = new Set();
    replaceStatus.textContent = '';
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    try {
        for (const file of files) {
            const rel = file.webkitRelativePath || file.name;
            if (/\.zip$/i.test(file.name)) {
                const names = await readZipFileNames(file);
                names.forEach(name => replacementTargetNames.add(normalizeTemplateName(name)));
            } else {
                replacementTargetNames.add(normalizeTemplateName(rel));
            }
        }
        replaceStatus.textContent = `${replacementTargetNames.size} target filenames loaded`;
    } catch (error) {
        replacementTargetNames = new Set();
        replaceStatus.textContent = 'Template scan failed';
        showStatus(`Replacement template error: ${error.message}`, 'error');
    }
}

const REPLACEMENT_ZIP_LIMITS = Object.freeze({
    maxBytes: 64 * 1024 * 1024,
    maxEntries: 10000,
    maxCentralDirectoryBytes: 16 * 1024 * 1024,
    maxNameBytes: 1024,
    maxTotalNameBytes: 2 * 1024 * 1024
});

async function readZipFileNames(file) {
    if (typeof file?.size === 'number' && file.size > REPLACEMENT_ZIP_LIMITS.maxBytes) {
        throw new Error(`Replacement ZIP exceeds the ${REPLACEMENT_ZIP_LIMITS.maxBytes / 1024 / 1024} MB limit.`);
    }
    const buffer = await file.arrayBuffer();
    if (buffer.byteLength > REPLACEMENT_ZIP_LIMITS.maxBytes) {
        throw new Error(`Replacement ZIP exceeds the ${REPLACEMENT_ZIP_LIMITS.maxBytes / 1024 / 1024} MB limit.`);
    }
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    if (bytes.length < 22) throw new Error('ZIP is too short to contain an end-of-directory record.');
    const min = Math.max(0, bytes.length - 65557);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= min; i--) {
        if (view.getUint32(i, true) === 0x06054b50) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0) throw new Error('ZIP directory not found.');
    if (eocd + 22 > bytes.length) throw new Error('ZIP end-of-directory record is truncated.');
    const commentLength = view.getUint16(eocd + 20, true);
    if (eocd + 22 + commentLength !== bytes.length) {
        throw new Error('ZIP end-of-directory length is inconsistent.');
    }
    const diskNumber = view.getUint16(eocd + 4, true);
    const centralDisk = view.getUint16(eocd + 6, true);
    const entriesOnDisk = view.getUint16(eocd + 8, true);
    const totalEntries = view.getUint16(eocd + 10, true);
    if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== totalEntries) {
        throw new Error('Multi-disk replacement ZIPs are not supported.');
    }
    if (totalEntries === 0xffff) throw new Error('ZIP64 replacement templates are not supported.');
    if (totalEntries > REPLACEMENT_ZIP_LIMITS.maxEntries) {
        throw new Error(`Replacement ZIP exceeds the ${REPLACEMENT_ZIP_LIMITS.maxEntries}-entry limit.`);
    }
    const centralSize = view.getUint32(eocd + 12, true);
    const centralOffset = view.getUint32(eocd + 16, true);
    if (centralSize > REPLACEMENT_ZIP_LIMITS.maxCentralDirectoryBytes) {
        throw new Error(`Replacement ZIP central directory exceeds the ${REPLACEMENT_ZIP_LIMITS.maxCentralDirectoryBytes / 1024 / 1024} MB limit.`);
    }
    const centralEnd = centralOffset + centralSize;
    if (centralOffset > eocd || centralEnd > eocd || centralEnd > bytes.length) {
        throw new Error('ZIP central-directory offset or length is out of bounds.');
    }
    let offset = centralOffset;
    let totalNameBytes = 0;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const names = [];

    for (let i = 0; i < totalEntries; i++) {
        if (offset + 46 > centralEnd) throw new Error(`ZIP central-directory entry ${i + 1} is truncated.`);
        if (view.getUint32(offset, true) !== 0x02014b50) {
            throw new Error(`ZIP central-directory entry ${i + 1} has an invalid signature.`);
        }
        const nameLen = view.getUint16(offset + 28, true);
        const extraLen = view.getUint16(offset + 30, true);
        const commentLen = view.getUint16(offset + 32, true);
        if (nameLen > REPLACEMENT_ZIP_LIMITS.maxNameBytes) {
            throw new Error(`ZIP entry ${i + 1} filename exceeds the ${REPLACEMENT_ZIP_LIMITS.maxNameBytes}-byte limit.`);
        }
        totalNameBytes += nameLen;
        if (totalNameBytes > REPLACEMENT_ZIP_LIMITS.maxTotalNameBytes) {
            throw new Error(`Replacement ZIP filenames exceed the ${REPLACEMENT_ZIP_LIMITS.maxTotalNameBytes / 1024 / 1024} MB total-work limit.`);
        }
        const nameStart = offset + 46;
        const entryEnd = nameStart + nameLen + extraLen + commentLen;
        if (entryEnd > centralEnd) throw new Error(`ZIP central-directory entry ${i + 1} extends out of bounds.`);
        let name;
        try {
            name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLen));
        } catch {
            throw new Error(`ZIP entry ${i + 1} filename is not valid UTF-8.`);
        }
        if (/[\u0000-\u001f\u007f]/.test(name)) {
            throw new Error(`ZIP entry ${i + 1} filename contains control characters.`);
        }
        names.push(name);
        offset = entryEnd;
    }
    if (offset !== centralEnd) throw new Error('ZIP central-directory size does not match its entries.');
    return names.filter(name => name && !name.endsWith('/'));
}

function isSvgFile(file) {
    return file?.type === 'image/svg+xml' || /\.svg$/i.test(file?.name || '');
}

function readFile(file, method, errorMessage) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => resolve(event.target.result);
        reader.onerror = () => reject(new Error(errorMessage));
        reader.onabort = () => reject(new Error(errorMessage));
        reader[method](file);
    });
}

function readFileAsText(file) {
    return readFile(file, 'readAsText', 'Failed to read SVG file.');
}

function readFileAsDataUrl(file) {
    return readFile(file, 'readAsDataURL', 'Failed to read image file.');
}

function loadImageElement(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Failed to load image. Make sure it is a valid image file.'));
        img.src = src;
    });
}

function validateSvgSourceText(svgText, fileName = 'SVG file') {
    const text = String(svgText || '').replace(/^\uFEFF/, '').trim();
    if (!text) throw new Error(`${fileName} is empty.`);

    if (typeof DOMParser !== 'undefined') {
        const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
        const parserError = doc.querySelector('parsererror');
        if (parserError) throw new Error(`${fileName} is malformed SVG. Fix the XML and try again.`);
        const root = doc.documentElement;
        if (!root || String(root.localName || '').toLowerCase() !== 'svg') {
            throw new Error(`${fileName} does not contain an SVG root element.`);
        }
    } else if (!/^<svg[\s>]/i.test(text)) {
        throw new Error(`${fileName} does not contain an SVG root element.`);
    }

    if (/<script[\s>]/i.test(text) || /<\s*(?:iframe|object|embed|foreignObject)\b/i.test(text)) {
        throw new Error(`${fileName} contains active SVG content that cannot be safely exported to canvas.`);
    }

    const externalAttribute = /\b(?:href|xlink:href|src|data|poster)\s*=\s*["']\s*(?:https?:|file:|blob:|\/\/)/i;
    const externalCss = /(?:@import\s+|url\()\s*["']?\s*(?:https?:|file:|blob:|\/\/)/i;
    if (externalAttribute.test(text) || externalCss.test(text)) {
        throw new Error(`${fileName} contains external references that can taint canvas exports. Inline the referenced assets and try again.`);
    }

    return text;
}

function reportImageInputError(error) {
    const message = error?.message || 'Failed to load image.';
    showStatus(message, 'error');
    setElementVisible(outputSection, true, 'block');
    renderGenerationDiagnostics({ selectedFormats: getSelectedFormats(), error: new Error(message) });
}

function activateLoadedImage(file, img, previewSrc, detail = '') {
    sourceImage = img;
    originalImageData = previewSrc;
    previewImage.src = previewSrc;
    setPreviewInfo(file.name, img.naturalWidth, img.naturalHeight, detail);
    setElementVisible(dropZone, false);
    previewContainer.classList.add('active');
    btnGenerate.disabled = false;
    setElementVisible(outputSection, false);
    showStatus('', '');

    cropSection.classList.add('active');
    cropRegion = null;
    initCropCanvas();
    updateMaskPreview();
    saveDraftState({ silent: true });
}

async function loadImage(file) {
    try {
        if (!file || (!file.type?.startsWith('image/') && !isSvgFile(file))) {
            throw new Error(uiText('status.imageInvalid'));
        }

        const sizeMB = file.size / (1024 * 1024);
        if (sizeMB > 200) {
            throw new Error(uiText('status.fileTooLarge', { size: sizeMB.toFixed(0) }));
        }
        if (sizeMB > 50) {
            showStatus(uiText('status.largeFile', { size: sizeMB.toFixed(0) }), 'warning');
        }

        if (isSvgFile(file)) {
            validateSvgSourceText(await readFileAsText(file), file.name || 'SVG file');
        }

        sourceFileName = file.name.replace(/\.[^/.]+$/, '');
        sourceMode = 'upload';

        const dataUrl = await readFileAsDataUrl(file);
        const img = await loadImageElement(dataUrl);

        const safeSize = limitImageSize(img.naturalWidth, img.naturalHeight);
        if (!safeSize.scaled) {
            activateLoadedImage(file, img, dataUrl);
            return true;
        }

        const tmpCanvas = document.createElement('canvas');
        tmpCanvas.width = safeSize.width;
        tmpCanvas.height = safeSize.height;
        try {
            const tmpCtx = tmpCanvas.getContext('2d');
            tmpCtx.drawImage(img, 0, 0, safeSize.width, safeSize.height);
            const scaledDataUrl = tmpCanvas.toDataURL('image/png');
            const scaledImg = await loadImageElement(scaledDataUrl);
            activateLoadedImage(file, scaledImg, scaledDataUrl, `downscaled from ${img.naturalWidth}x${img.naturalHeight}`);
            showStatus(uiText('status.imageDownscaled', { fromWidth: img.naturalWidth, fromHeight: img.naturalHeight, toWidth: safeSize.width, toHeight: safeSize.height }), 'warning');
            return true;
        } finally {
            tmpCanvas.width = 0;
            tmpCanvas.height = 0;
        }
    } catch (error) {
        reportImageInputError(error);
        return false;
    }
}

async function handleLaunchFiles(fileHandles = []) {
    const handles = Array.from(fileHandles || []).filter(handle => typeof handle?.getFile === 'function');
    if (!handles.length) return false;
    const handle = handles[0];
    try {
        const file = await handle.getFile();
        const loaded = await loadImage(file);
        if (!loaded) return false;
        showStatus(handles.length > 1
            ? uiText('status.launchedFileOpenedExtra', { name: file.name, count: handles.length - 1, fileWord: handles.length === 2 ? 'file' : 'files' })
            : uiText('status.launchedFileOpened', { name: file.name }),
            handles.length > 1 ? 'warning' : 'success');
        return true;
    } catch (error) {
        showStatus(uiText('status.launchedFileFailed', { message: error.message }), 'error');
        return false;
    }
}

function initFileHandlingLaunch() {
    if (!featureSupport.fileHandling || typeof window.launchQueue?.setConsumer !== 'function') return;
    window.launchQueue.setConsumer((launchParams) => {
        handleLaunchFiles(launchParams.files);
    });
}
initFileHandlingLaunch();

function resetInput() {
    sourceImage = null;
    sourceFileName = '';
    sourceMode = 'upload';
    originalImageData = null;
    cropRegion = null;
    fileInput.value = '';
    setElementVisible(dropZone, true);
    previewContainer.classList.remove('active');
    cropSection.classList.remove('active');
    btnGenerate.disabled = true;
    setElementVisible(outputSection, false);
    generatedFiles = [];
    generatedSnippets = {};
    isManualCropMode = false;
    btnManualCrop.classList.remove('active');
    setElementVisible(btnApplyCrop, false);
    revokeOutputUrls();
    updateMaskPreview();
    saveDraftState({ silent: true });
}

function revokeOutputUrls() {
    outputGrid.querySelectorAll('img[src^="blob:"]').forEach(img => {
        URL.revokeObjectURL(img.src);
    });
}

// ==================== CROP FUNCTIONS ====================

function initCropCanvas() {
    if (!sourceImage) return;
    
    // Calculate display size (fit within container)
    const maxWidth = 450;
    const maxHeight = 400;
    const scale = Math.min(maxWidth / sourceImage.naturalWidth, maxHeight / sourceImage.naturalHeight, 1);
    
    cropCanvas.width = sourceImage.naturalWidth * scale;
    cropCanvas.height = sourceImage.naturalHeight * scale;
    cropCanvas.dataset.scale = scale;
    
    drawCropCanvas();
    updateCropInfo();
}

function drawCropCanvas() {
    if (!sourceImage) return;
    
    const scale = parseFloat(cropCanvas.dataset.scale) || 1;
    
    // Clear and draw image
    cropCtx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
    cropCtx.drawImage(sourceImage, 0, 0, cropCanvas.width, cropCanvas.height);
    
    // Draw crop overlay if we have a crop region
    if (cropRegion || currentCropRect) {
        const region = currentCropRect || cropRegion;
        const x = region.x * scale;
        const y = region.y * scale;
        const w = region.width * scale;
        const h = region.height * scale;
        
        // Darken areas outside crop
        cropCtx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        // Top
        cropCtx.fillRect(0, 0, cropCanvas.width, y);
        // Bottom
        cropCtx.fillRect(0, y + h, cropCanvas.width, cropCanvas.height - y - h);
        // Left
        cropCtx.fillRect(0, y, x, h);
        // Right
        cropCtx.fillRect(x + w, y, cropCanvas.width - x - w, h);
        
        // Draw crop border
        cropCtx.strokeStyle = '#3b82f6';
        cropCtx.lineWidth = 2;
        cropCtx.setLineDash([5, 5]);
        cropCtx.strokeRect(x, y, w, h);
        cropCtx.setLineDash([]);
        
        // Draw corner handles
        const handleSize = 8;
        cropCtx.fillStyle = '#3b82f6';
        // Corners
        cropCtx.fillRect(x - handleSize/2, y - handleSize/2, handleSize, handleSize);
        cropCtx.fillRect(x + w - handleSize/2, y - handleSize/2, handleSize, handleSize);
        cropCtx.fillRect(x - handleSize/2, y + h - handleSize/2, handleSize, handleSize);
        cropCtx.fillRect(x + w - handleSize/2, y + h - handleSize/2, handleSize, handleSize);
    }
    
    // Show manual crop mode indicator
    if (isManualCropMode && !currentCropRect && !cropRegion) {
        cropCtx.fillStyle = 'rgba(59, 130, 246, 0.1)';
        cropCtx.fillRect(0, 0, cropCanvas.width, cropCanvas.height);
        cropCtx.strokeStyle = '#3b82f6';
        cropCtx.lineWidth = 2;
        cropCtx.setLineDash([10, 5]);
        cropCtx.strokeRect(2, 2, cropCanvas.width - 4, cropCanvas.height - 4);
        cropCtx.setLineDash([]);
    }
}

function updateCropInfo() {
    if (cropRegion) {
        cropDimensions.textContent = `${cropRegion.width} x ${cropRegion.height} (from ${sourceImage.naturalWidth} x ${sourceImage.naturalHeight})`;
    } else {
        cropDimensions.textContent = `Full image (${sourceImage.naturalWidth} x ${sourceImage.naturalHeight})`;
    }
    syncCropInputs();
}

function syncCropInputs() {
    if (cropRegion) {
        cropXInput.value = cropRegion.x;
        cropYInput.value = cropRegion.y;
        cropWInput.value = cropRegion.width;
        cropHInput.value = cropRegion.height;
    } else if (sourceImage) {
        cropXInput.value = 0;
        cropYInput.value = 0;
        cropWInput.value = sourceImage.naturalWidth;
        cropHInput.value = sourceImage.naturalHeight;
    }
    if (sourceImage) {
        cropXInput.max = sourceImage.naturalWidth - 1;
        cropYInput.max = sourceImage.naturalHeight - 1;
        cropWInput.max = sourceImage.naturalWidth;
        cropHInput.max = sourceImage.naturalHeight;
    }
}

function applyNumericCrop() {
    if (!sourceImage) return;
    const x = Math.max(0, parseInt(cropXInput.value) || 0);
    const y = Math.max(0, parseInt(cropYInput.value) || 0);
    const w = Math.min(parseInt(cropWInput.value) || sourceImage.naturalWidth, sourceImage.naturalWidth - x);
    const h = Math.min(parseInt(cropHInput.value) || sourceImage.naturalHeight, sourceImage.naturalHeight - y);
    if (w < 1 || h < 1) {
        cropStatus.textContent = 'Invalid crop dimensions';
        setTimeout(() => { cropStatus.textContent = ''; }, 2000);
        return;
    }
    cropRegion = { x, y, width: w, height: h };
    currentCropRect = null;
    isManualCropMode = false;
    btnManualCrop.classList.remove('active');
    setElementVisible(btnApplyCrop, false);
    drawCropCanvas();
    updateCropInfo();
    updatePreviewWithCrop();
    updateMaskPreview();
    cropStatus.textContent = 'Crop applied!';
    saveDraftState({ silent: true });
    setTimeout(() => { cropStatus.textContent = ''; }, 2000);
}

function performAutoCrop() {
    if (!sourceImage) return;
    
    cropStatus.textContent = 'Analyzing...';
    
    // Use setTimeout to allow UI to update
    setTimeout(() => {
        const tolerance = parseInt(toleranceSlider.value);
        const bounds = detectContentBounds(sourceImage, tolerance);
        
        if (bounds) {
            cropRegion = bounds;
            currentCropRect = null;
            drawCropCanvas();
            updateCropInfo();
            cropStatus.textContent = 'Auto-crop applied!';
            
            // Update preview
            updatePreviewWithCrop();
            updateMaskPreview();
            saveDraftState({ silent: true });
        } else {
            cropStatus.textContent = 'No empty space detected';
        }
        
        setTimeout(() => { cropStatus.textContent = ''; }, 2000);
    }, 50);
}

function detectContentBounds(img, tolerance = 10) {
    // Create a temporary canvas to analyze pixels
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const width = canvas.width;
    const height = canvas.height;
    
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let foundContent = false;
    
    // Scan all pixels to find content bounds
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            const a = data[idx + 3];
            
            // Check if pixel is "content" (not transparent/near-white)
            const isTransparent = a < (255 - tolerance * 5);
            const isNearWhite = (r > 255 - tolerance && g > 255 - tolerance && b > 255 - tolerance);
            const isNearBlack = (r < tolerance && g < tolerance && b < tolerance && a < tolerance * 5);
            
            // Consider as content if:
            // - Not fully transparent
            // - Not near-white (for white backgrounds)
            // - Has some opacity
            const isContent = a > tolerance * 5 && !(isNearWhite && a > 250);
            
            if (isContent) {
                foundContent = true;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }
    
    canvas.width = 0;
    canvas.height = 0;

    if (!foundContent) return null;

    // Add configurable safe-area padding around detected content.
    const padding = Math.max(2, Math.round(Math.min(width, height) * ((parseInt(safePaddingSlider.value, 10) || 0) / 100)));
    minX = Math.max(0, minX - padding);
    minY = Math.max(0, minY - padding);
    maxX = Math.min(width - 1, maxX + padding);
    maxY = Math.min(height - 1, maxY + padding);
    
    const cropWidth = maxX - minX + 1;
    const cropHeight = maxY - minY + 1;
    
    // Only return if we actually found something to crop
    if (cropWidth >= width - padding * 2 && cropHeight >= height - padding * 2) {
        return null; // No significant cropping needed
    }
    
    return {
        x: minX,
        y: minY,
        width: cropWidth,
        height: cropHeight
    };
}

function toggleManualCropMode() {
    isManualCropMode = !isManualCropMode;
    btnManualCrop.classList.toggle('active', isManualCropMode);
    setElementVisible(btnApplyCrop, isManualCropMode, 'flex');
    
    if (isManualCropMode) {
        cropStatus.textContent = 'Draw a crop rectangle on the image';
        currentCropRect = null;
    } else {
        cropStatus.textContent = '';
    }
    
    drawCropCanvas();
}

function startCropDrag(e) {
    if (!isManualCropMode) return;
    
    const rect = cropCanvas.getBoundingClientRect();
    const scale = parseFloat(cropCanvas.dataset.scale) || 1;
    
    isDragging = true;
    dragStart = {
        x: (e.clientX - rect.left) / scale,
        y: (e.clientY - rect.top) / scale
    };
    currentCropRect = null;
}

function updateCropDrag(e) {
    if (!isDragging || !isManualCropMode) return;
    
    const rect = cropCanvas.getBoundingClientRect();
    const scale = parseFloat(cropCanvas.dataset.scale) || 1;
    
    const currentX = (e.clientX - rect.left) / scale;
    const currentY = (e.clientY - rect.top) / scale;
    
    // Calculate crop rectangle
    const x = Math.max(0, Math.min(dragStart.x, currentX));
    const y = Math.max(0, Math.min(dragStart.y, currentY));
    const width = Math.min(sourceImage.naturalWidth - x, Math.abs(currentX - dragStart.x));
    const height = Math.min(sourceImage.naturalHeight - y, Math.abs(currentY - dragStart.y));
    
    currentCropRect = {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height)
    };
    
    drawCropCanvas();
    
    // Update dimensions display
    if (currentCropRect.width > 0 && currentCropRect.height > 0) {
        cropDimensions.textContent = `${currentCropRect.width} x ${currentCropRect.height}`;
    }
}

function endCropDrag() {
    if (!isDragging) return;
    isDragging = false;
    
    if (currentCropRect && currentCropRect.width > 10 && currentCropRect.height > 10) {
        cropStatus.textContent = 'Click "Apply Crop" to confirm';
    } else {
        currentCropRect = null;
        drawCropCanvas();
    }
}

function applyCrop() {
    if (currentCropRect && currentCropRect.width > 0 && currentCropRect.height > 0) {
        cropRegion = { ...currentCropRect };
        currentCropRect = null;
        isManualCropMode = false;
        btnManualCrop.classList.remove('active');
        setElementVisible(btnApplyCrop, false);
        
        drawCropCanvas();
        updateCropInfo();
        updatePreviewWithCrop();
        updateMaskPreview();
        
        cropStatus.textContent = 'Crop applied!';
        saveDraftState({ silent: true });
        setTimeout(() => { cropStatus.textContent = ''; }, 2000);
    }
}

function resetCrop() {
    cropRegion = null;
    currentCropRect = null;
    isManualCropMode = false;
    btnManualCrop.classList.remove('active');
    setElementVisible(btnApplyCrop, false);
    
    // Reset preview to original
    if (originalImageData && sourceImage) {
        previewImage.src = originalImageData;
        setPreviewInfo(sourceFileName, sourceImage.naturalWidth, sourceImage.naturalHeight);
    }
    
    drawCropCanvas();
    updateCropInfo();
    updateMaskPreview();
    cropStatus.textContent = 'Crop reset';
    saveDraftState({ silent: true });
    setTimeout(() => { cropStatus.textContent = ''; }, 2000);
}

function updatePreviewWithCrop() {
    if (!cropRegion || !sourceImage) return;

    const canvas = document.createElement('canvas');
    canvas.width = cropRegion.width;
    canvas.height = cropRegion.height;
    const ctx = canvas.getContext('2d');

    ctx.drawImage(
        sourceImage,
        cropRegion.x, cropRegion.y, cropRegion.width, cropRegion.height,
        0, 0, cropRegion.width, cropRegion.height
    );

    previewImage.src = canvas.toDataURL('image/png');
    canvas.width = 0;
    canvas.height = 0;
    setPreviewInfo(sourceFileName, cropRegion.width, cropRegion.height, 'cropped');
    updateMaskPreview();
}

function getCroppedImage() {
    if (!sourceImage) return null;
    if (!cropRegion) return { element: sourceImage, crop: null };
    return { element: sourceImage, crop: cropRegion };
}

// ==================== RESIZE WORKER ====================

const workerCode = `
self.onmessage = async function(e) {
    const { id, bitmap, width, height, format, crop, quality } = e.data;
    try {
const canvas = new OffscreenCanvas(width, height);
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = true;
ctx.imageSmoothingQuality = 'high';
const srcX = crop ? crop.x : 0, srcY = crop ? crop.y : 0;
const srcW = crop ? crop.width : bitmap.width, srcH = crop ? crop.height : bitmap.height;
const scale = Math.min(width / srcW, height / srcH);
const sw = srcW * scale, sh = srcH * scale;
const dx = (width - sw) / 2, dy = (height - sh) / 2;
if (format === 'jpg') { ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, width, height); }
ctx.drawImage(bitmap, srcX, srcY, srcW, srcH, dx, dy, sw, sh);
bitmap.close();
const mimeType = format === 'jpg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : format === 'avif' ? 'image/avif' : 'image/png';
const blob = await canvas.convertToBlob({ type: mimeType, quality: format === 'png' ? undefined : quality || 0.92 });
if (!blob || !blob.size) throw new Error(format.toUpperCase() + ' worker encoder returned no image data');
self.postMessage({ id, blob });
    } catch (err) {
self.postMessage({ id, error: err.message });
    }
};`;

let resizeWorker = null;
let workerJobId = 0;
const workerCallbacks = new Map();
const WORKER_RESIZE_TIMEOUT_MS = 30000;
const CANVAS_ENCODER_TIMEOUT_MS = 15000;

function settleWorkerJob(id, blob = null, error = null) {
    const job = workerCallbacks.get(id);
    if (!job) return false;
    workerCallbacks.delete(id);
    clearTimeout(job.timer);
    if (error) job.reject(error instanceof Error ? error : new Error(String(error)));
    else job.resolve(blob);
    return true;
}

function rejectPendingWorkerJobs(reason) {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    for (const id of Array.from(workerCallbacks.keys())) {
        settleWorkerJob(id, null, error);
    }
}

function disposeResizeWorker(reason = 'Resize worker stopped.', rejectPending = true) {
    const worker = resizeWorker;
    resizeWorker = null;
    featureSupport.blobWorker = false;
    if (worker) {
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        try {
            worker.terminate();
        } catch {
            // The worker may already have terminated itself.
        }
    }
    if (rejectPending) rejectPendingWorkerJobs(reason);
}

function initWorker() {
    let url = '';
    try {
        if (resizeWorker) disposeResizeWorker('Resize worker replaced.');
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        url = URL.createObjectURL(blob);
        const worker = new Worker(url);
        resizeWorker = worker;
        featureSupport.blobWorker = true;
        worker.onmessage = (event) => {
            if (worker !== resizeWorker) return;
            const message = event && event.data ? event.data : {};
            if (!Number.isInteger(message.id)) return;
            if (message.error) settleWorkerJob(message.id, null, new Error(message.error));
            else settleWorkerJob(message.id, message.blob);
        };
        worker.onerror = (event) => {
            event?.preventDefault?.();
            if (worker !== resizeWorker) return;
            const detail = event?.message ? `: ${event.message}` : '';
            disposeResizeWorker(`Resize worker crashed${detail}`);
        };
        worker.onmessageerror = () => {
            if (worker !== resizeWorker) return;
            disposeResizeWorker('Resize worker returned an unreadable response.');
        };
    } catch (error) {
        disposeResizeWorker(`Resize worker initialization failed: ${error.message}`);
    } finally {
        if (url) URL.revokeObjectURL(url);
    }
    return resizeWorker;
}
initWorker();

// Feature-detect WebP and AVIF encoding support
(async function detectFormats() {
    const c = document.createElement('canvas');
    c.width = 1; c.height = 1;
    try {
        const blob = await canvasToBlobWithTimeout(c, 'image/webp', undefined, 5000);
        featureSupport.webpChecked = true;
        featureSupport.webpEncode = Boolean(blob && blob.type === 'image/webp');
        if (blob && blob.type === 'image/webp') {
            setElementVisible(document.getElementById('webpFormatOption'), true);
        }
        const blob2 = await canvasToBlobWithTimeout(c, 'image/avif', undefined, 5000);
        featureSupport.avifChecked = true;
        featureSupport.avifEncode = Boolean(blob2 && blob2.type === 'image/avif');
        if (blob2 && blob2.type === 'image/avif') {
            setElementVisible(document.getElementById('avifFormatOption'), true);
        }
    } catch {
        if (!featureSupport.webpChecked) {
            featureSupport.webpChecked = true;
            featureSupport.webpEncode = false;
        }
        if (!featureSupport.avifChecked) {
            featureSupport.avifChecked = true;
            featureSupport.avifEncode = false;
        }
    } finally {
        c.width = 0;
        c.height = 0;
    }
})();

function resizeInWorker(bitmap, width, height, format, crop, quality, timeoutMs = WORKER_RESIZE_TIMEOUT_MS) {
    const worker = resizeWorker;
    if (!worker) return Promise.reject(new Error('Resize worker is unavailable.'));
    return new Promise((resolve, reject) => {
        const id = ++workerJobId;
        const timer = setTimeout(() => {
            disposeResizeWorker(`Worker resize timed out after ${timeoutMs}ms.`);
        }, timeoutMs);
        workerCallbacks.set(id, { resolve, reject, timer });
        try {
            worker.postMessage({ id, bitmap, width, height, format, crop, quality }, [bitmap]);
        } catch (error) {
            settleWorkerJob(id, null, new Error(`Could not send resize job to worker: ${error.message}`));
            if (worker === resizeWorker) {
                disposeResizeWorker('Resize worker transfer failed.');
            }
        }
    });
}

// ==================== END CROP FUNCTIONS ====================

function findSizeInput(size) {
    return Array.from(sizeGrid.querySelectorAll('input[type="checkbox"]')).find(input => {
        const w = parseInt(input.value, 10);
        const h = parseInt(input.dataset.height, 10) || w;
        return w === size.width && h === size.height;
    });
}

function ensureSizeOption(entry) {
    const size = normalizeSizeEntry(entry);
    if (findSizeInput(size)) return;

    const label = document.createElement('label');
    label.className = 'size-option';
    label.innerHTML = `
        <input type="checkbox" value="${size.width}" data-height="${size.height}">
        <span class="size-checkbox">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"/>
            </svg>
        </span>
        <span class="size-label">${size.width}x${size.height} <small>preset</small></span>
    `;
    sizeGrid.appendChild(label);
}

function addCustomSize() {
    const w = parseInt(customWidth.value) || parseInt(customHeight.value);
    const h = parseInt(customHeight.value) || parseInt(customWidth.value);
    
    if (!w || !h || w < 1 || h < 1 || w > 4096 || h > 4096) {
        showStatus('Please enter valid dimensions (1-4096)', 'warning');
        return;
    }

    const existing = findSizeInput({ width: w, height: h });
    if (existing) {
        existing.checked = true;
        existing.closest('.size-option').classList.add('selected');
        showStatus(`Size ${w}x${h} already exists and has been selected`, 'info');
        saveDraftState({ silent: true });
        return;
    }

    const label = document.createElement('label');
    label.className = 'size-option selected';
    label.innerHTML = `
        <input type="checkbox" value="${w}" data-height="${h}" checked>
        <span class="size-checkbox">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"/>
            </svg>
        </span>
        <span class="size-label">${w}x${h} <small>custom</small></span>
    `;
    sizeGrid.appendChild(label);
    
    customWidth.value = '';
    customHeight.value = '';
    showStatus(`Added custom size ${w}x${h}`, 'success');
    saveDraftState({ silent: true });
}

function getSelectedSizes() {
    const sizes = [];
    sizeGrid.querySelectorAll('input:checked').forEach(input => {
        const w = parseInt(input.value);
        const h = parseInt(input.dataset.height) || w;
        sizes.push({ width: w, height: h });
    });
    return sizes;
}

function generateSvgFavicon(img, crop) {
    const svgSize = 32;
    const canvas = document.createElement('canvas');
    canvas.width = svgSize;
    canvas.height = svgSize;
    const ctx = canvas.getContext('2d');
    drawIconToContext(ctx, img, svgSize, svgSize, crop, getProcessingOptions({ paddingPercent: 0, backgroundMode: 'transparent' }));

    const dataUrl = canvas.toDataURL('image/png');
    canvas.width = 0;
    canvas.height = 0;

    const lightColor = normalizeSvgColor(document.getElementById('svgLightColor').value, '#1a1a1a');
    const darkColor = normalizeSvgColor(document.getElementById('svgDarkColor').value, '#f0f0f0');

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgSize} ${svgSize}">
  <style>
    .iconforge-bg { fill: ${lightColor}; }
    @media (prefers-color-scheme: dark) {
      .iconforge-bg { fill: ${darkColor}; }
    }
  </style>
  <rect class="iconforge-bg" width="${svgSize}" height="${svgSize}" rx="6"/>
  <image href="${dataUrl}" width="${svgSize}" height="${svgSize}"/>
</svg>`;
}

function getSelectedFormats() {
    const formats = [];
    formatOptions.querySelectorAll('input:checked').forEach(input => {
        formats.push(input.value);
    });
    return formats;
}

class OperationCancelledError extends Error {
    constructor(message = 'Operation cancelled.') {
        super(message);
        this.name = 'AbortError';
    }
}

function throwIfOperationCancelled(signal) {
    if (signal?.aborted) throw new OperationCancelledError();
}

function setOperationProgress(stage, fileName, completed, total) {
    const safeTotal = Math.max(1, total || 1);
    const safeCompleted = Math.min(safeTotal, Math.max(0, completed || 0));
    const percent = Math.round((safeCompleted / safeTotal) * 100);
    generationProgressBar?.setAttribute('aria-valuenow', String(percent));
    if (generationProgressFill) generationProgressFill.style.width = `${percent}%`;
    if (generationProgressLabel) {
        const detail = fileName ? ` — ${fileName}` : '';
        generationProgressLabel.textContent = `${stage}${detail} (${safeCompleted}/${safeTotal})`;
    }
}

function beginOperation(kind, total) {
    if (activeOperation) throw new Error(`Another ${activeOperation.kind} operation is already running.`);
    const operation = {
        kind,
        total: Math.max(1, total || 1),
        completed: 0,
        controller: new AbortController()
    };
    activeOperation = operation;
    setElementVisible(generationProgress, true);
    setElementVisible(btnCancelOperation, true);
    setOperationProgress(kind === 'generation' ? 'Preparing generation' : 'Preparing folder export', '', 0, operation.total);
    return operation;
}

function finishOperation(operation) {
    if (activeOperation !== operation) return;
    activeOperation = null;
    setElementVisible(generationProgress, false);
    setElementVisible(btnCancelOperation, false);
}

function cancelActiveOperation() {
    if (!activeOperation || activeOperation.controller.signal.aborted) return;
    activeOperation.controller.abort();
    if (activeOperation.kind === 'generation') {
        disposeResizeWorker('Generation cancelled.');
    }
    showStatus(`Cancelling ${activeOperation.kind}…`, 'warning');
}

async function runOperationStep(operation, stage, fileName, action) {
    const signal = operation.controller.signal;
    throwIfOperationCancelled(signal);
    setOperationProgress(stage, fileName, operation.completed, operation.total);
    let abortHandler = null;
    const abortPromise = new Promise((resolve, reject) => {
        abortHandler = () => reject(new OperationCancelledError());
        signal.addEventListener('abort', abortHandler, { once: true });
    });
    let result;
    try {
        result = await Promise.race([Promise.resolve().then(action), abortPromise]);
    } finally {
        if (abortHandler) signal.removeEventListener('abort', abortHandler);
    }
    throwIfOperationCancelled(signal);
    operation.completed++;
    setOperationProgress(stage, fileName, operation.completed, operation.total);
    return result;
}

function getPlatformGenerationOperationCount() {
    let count = 0;
    if (activePresetKey === 'pwa') count = PWA_ICON_SIZES.length * 2 + PWA_SPLASH_SPECS.length * 2;
    else if (activePresetKey === 'android') count = ANDROID_DENSITY_SPECS.length * 3;
    else if (activePresetKey === 'ios') count = IOS_ICON_SPECS.length;
    else if (activePresetKey === 'windows') count = WINDOWS_TILE_SPECS.length;
    if (manifestMonochromeEnabled() && ['web', 'pwa', 'all'].includes(activePresetKey)) count++;
    return count;
}

async function generateIcons() {
    if (!sourceImage) return;

    const sizes = getSelectedSizes();
    const formats = getSelectedFormats();
    const deploymentValidation = validateDeploymentUrlOptions();
    const manifestValidation = validateManifestMetadata();

    if (!deploymentValidation.valid) {
        showStatus(deploymentValidation.error, 'error');
        return;
    }
    if (manifestValidation.errors.length) {
        showStatus(`Manifest metadata: ${manifestValidation.errors[0]}`, 'error');
        return;
    }

    if (sizes.length === 0) {
        showStatus('Please select at least one size', 'warning');
        return;
    }

    if (formats.length === 0) {
        showStatus('Please select at least one format', 'warning');
        return;
    }

    const baseOps = formats.reduce((n, f) => n + (f === 'ico' || f === 'svg' ? 1 : sizes.length), 0);
    const operation = beginOperation('generation', baseOps + getPlatformGenerationOperationCount() + 2);
    btnGenerate.disabled = true;
    btnDownloadAll.disabled = true;
    if (btnSaveToFolder) btnSaveToFolder.disabled = true;
    btnGenerate.innerHTML = '<span class="spinner"></span> Generating...';
    showStatus('Preparing icon generation…', 'info');

    if (featureSupport.workerApi && featureSupport.offscreenCanvas && !resizeWorker) initWorker();
    revokeOutputUrls();
    outputGrid.innerHTML = '';
    setElementVisible(outputSection, false);
    generatedFiles = [];
    generatedSnippets = {};
    generationStats = createGenerationStats();

    try {
        const imgSource = sourceImage;
        const crop = cropRegion;

        for (const format of formats) {
            if (format === 'ico') {
                const icoSizes = sizes.filter(s => s.width <= 256 && s.width === s.height);
                const fileName = getOutputFileName({ format, size: { width: 'multi', height: 'multi' } });
                const blob = await runOperationStep(operation, 'Encoding', fileName, () =>
                    icoSizes.length > 0 ? generateICO(imgSource, icoSizes, crop) : null
                );
                if (blob) {
                    addGeneratedFile(fileName, blob, { width: 'multi', height: 'multi' }, 'ico', { icoSizes });
                }
            } else if (format === 'svg') {
                const fileName = getOutputFileName({ format, size: { width: 'svg', height: '' } });
                const svgStr = await runOperationStep(operation, 'Encoding', fileName, () => generateSvgFavicon(imgSource, crop));
                const blob = new Blob([svgStr], { type: 'image/svg+xml' });
                addGeneratedFile(fileName, blob, { width: 'svg', height: '' }, 'svg');
            } else {
                for (const size of sizes) {
                    const fileName = getOutputFileName({ format, size });
                    const { blob } = await runOperationStep(operation, 'Encoding', fileName, () =>
                        generateImage(imgSource, size, format, crop)
                    );
                    addGeneratedFile(fileName, blob, size, format, getGeneratedFileMeta(format, size));
                }
            }
        }

        await generatePlatformBundle(imgSource, crop, sizes, formats, operation);
        await runOperationStep(operation, 'Building metadata', 'snippets and manifests', () => generateSnippets(sizes, formats));
        setElementVisible(outputSection, true, 'block');
        const validationResult = await runOperationStep(operation, 'Validating', 'generated artifact contracts', () => renderExportValidation());
        renderGenerationDiagnostics({ selectedFormats: formats, validationResult });
        const totalSize = generatedFiles.reduce((s, f) => s + f.blob.size, 0);
        const budgetBytes = getSizeBudgetBytes();
        const budgetImpact = budgetBytes ? `; ${getSizeBudgetStatus(totalSize)}` : '';
        showStatus(`Generated ${generatedFiles.length} files (${formatFileSize(totalSize)} total${budgetImpact})`, 'success');
    } catch (error) {
        if (error.name === 'AbortError') {
            disposeResizeWorker('Generation cancelled.');
            revokeOutputUrls();
            outputGrid.innerHTML = '';
            generatedFiles = [];
            generatedSnippets = {};
            setElementVisible(outputSection, false);
            showStatus('Generation cancelled. No partial output was retained; Generate Icons is ready to retry.', 'warning');
        } else {
            setElementVisible(outputSection, true, 'block');
            renderGenerationDiagnostics({ selectedFormats: formats, error });
            showStatus(`Error: ${error.message}`, 'error');
            console.error(error);
        }
    } finally {
        finishOperation(operation);
        btnGenerate.disabled = false;
        btnDownloadAll.disabled = false;
        if (btnSaveToFolder) btnSaveToFolder.disabled = false;
        btnGenerate.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
            Generate Icons
        `;
    }
}

function assertValidOutputBlob(blob, context = 'Generated image') {
    if (!blob || typeof blob.size !== 'number' || typeof blob.arrayBuffer !== 'function') {
        throw new Error(`${context} did not produce a file blob.`);
    }
    if (blob.size <= 0) {
        throw new Error(`${context} produced an empty file.`);
    }
    return blob;
}

function canvasToBlobWithTimeout(canvas, mimeType, quality, timeoutMs = CANVAS_ENCODER_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        if (!canvas || typeof canvas.toBlob !== 'function') {
            reject(new Error('Canvas encoding is unavailable in this browser.'));
            return;
        }
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(new Error(`Canvas encoder timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
        try {
            canvas.toBlob((blob) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(blob);
            }, mimeType, quality);
        } catch (error) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(error);
        }
    });
}

async function canvasToOutputBlob(canvas, mimeType, quality, context, timeoutMs = CANVAS_ENCODER_TIMEOUT_MS) {
    let blob = null;
    try {
        blob = await canvasToBlobWithTimeout(canvas, mimeType, quality, timeoutMs);
    } catch (error) {
        throw new Error(`${context} encoder failed: ${error.message}`);
    }
    return assertValidOutputBlob(blob, `${context} encoder`);
}

async function generateImage(img, size, format, crop = null, bitmap = null) {
    const forceSolidBackground = (format === 'jpg' || activePresetKey === 'social') && backgroundMode.value === 'transparent';
    const options = getProcessingOptions({ backgroundMode: forceSolidBackground ? 'solid' : backgroundMode.value });
    const customProcessing = usesCustomProcessing(options);
    if (resizeWorker && featureSupport.offscreenCanvas && !customProcessing) {
        try {
            const bmp = bitmap || await createImageBitmap(img);
            const quality = format === 'png' ? undefined : getLossyQuality();
            const blob = assertValidOutputBlob(
                await resizeInWorker(bmp, size.width, size.height, format, crop, quality),
                `${formatLabel(format)} ${size.width}x${size.height} worker export`
            );
            noteWorkerJob();
            await new Promise(r => setTimeout(r, 0));
            return { blob };
        } catch (error) {
            disposeResizeWorker(`Resize worker export failed: ${error.message}`);
            noteCanvasFallback(`worker failed: ${error.message}`);
        }
    } else if (customProcessing) {
        noteCanvasFallback('processing options require canvas path');
    } else if (!featureSupport.workerApi) {
        noteCanvasFallback('Worker API unavailable');
    } else if (!featureSupport.offscreenCanvas) {
        noteCanvasFallback('OffscreenCanvas unavailable');
    } else {
        noteCanvasFallback('blob worker unavailable');
    }

    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    drawIconToContext(ctx, img, size.width, size.height, crop, options);

    const mimeType = format === 'jpg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : format === 'avif' ? 'image/avif' : 'image/png';
    const quality = format === 'png' ? undefined : getLossyQuality();

    try {
        const blob = await canvasToOutputBlob(canvas, mimeType, quality, `${formatLabel(format)} ${size.width}x${size.height}`);
        await new Promise(r => setTimeout(r, 0));
        return { blob };
    } finally {
        canvas.width = 0;
        canvas.height = 0;
    }
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    return (bytes / 1024).toFixed(1) + ' KB';
}

function addGeneratedFile(name, blob, size, format, meta = {}) {
    const safeBlob = assertValidOutputBlob(blob, `Generated file ${name}`);
    const existingIndex = generatedFiles.findIndex(file => file.name === name);
    const file = { name, blob: safeBlob, size, format, ...meta };
    if (existingIndex >= 0) {
        generatedFiles[existingIndex] = file;
    } else {
        generatedFiles.push(file);
    }
    addOutputItem(name, safeBlob, size, format, meta.icoSizes || null, safeBlob.size);
}

function getOutputFileName({ format, size }) {
    const stem = cleanPathSegment(sourceFileName);
    const isSquare = size.width === size.height;
    const wh = isSquare ? `${size.width}` : `${size.width}x${size.height}`;

    if (activePresetKey === 'web') {
        if (format === 'ico') return 'favicon.ico';
        if (format === 'svg') return 'icon.svg';
        if (format === 'png' && size.width === 180 && isSquare) return 'apple-touch-icon.png';
        if (format === 'png' && [192, 512].includes(size.width) && isSquare) return `icon-${size.width}.png`;
    }
    if (activePresetKey === 'extension' && format === 'png' && isSquare) {
        return `extension/icons/icon${size.width}.png`;
    }
    if (activePresetKey === 'pwa' && format === 'png' && isSquare) {
        return `pwa/icons/icon-${size.width}x${size.height}.png`;
    }
    if (activePresetKey === 'windows' && format === 'png') {
        return `windows/mstile-${size.width}x${size.height}.png`;
    }
    if (activePresetKey === 'windows' && format === 'ico') {
        return 'windows/favicon.ico';
    }
    if (activePresetKey === 'social' && format === 'png') {
        if (size.width === 1200 && size.height === 630) return 'social/og-image.png';
        if (size.width === 1200 && size.height === 675) return 'social/twitter-card.png';
        if (size.width === 1200 && size.height === 627) return 'social/linkedin-preview.png';
        return `social/social-${size.width}x${size.height}.png`;
    }
    if (format === 'ico') return `${stem}.ico`;
    if (format === 'svg') return `${stem}.svg`;
    return `${stem}-${wh}.${format}`;
}

function getGeneratedFileMeta(format, size) {
    if (activePresetKey !== 'social' || format !== 'png') return {};
    if (size.width === 1200 && size.height === 630) return { role: 'social', socialTarget: 'open-graph' };
    if (size.width === 1200 && size.height === 675) return { role: 'social', socialTarget: 'twitter' };
    if (size.width === 1200 && size.height === 627) return { role: 'social', socialTarget: 'linkedin' };
    return { role: 'social', socialTarget: 'custom' };
}

function hasGeneratedFile(name) {
    return generatedFiles.some(file => file.name === name);
}

async function renderIconBlob(img, width, height, crop, options, format = 'png') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    drawIconToContext(ctx, img, width, height, crop, options);
    const mimeType = format === 'jpg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : format === 'avif' ? 'image/avif' : 'image/png';
    try {
        return await canvasToOutputBlob(canvas, mimeType, format === 'png' ? undefined : getLossyQuality(), `${formatLabel(format)} ${width}x${height}`);
    } finally {
        canvas.width = 0;
        canvas.height = 0;
    }
}

async function renderSplashBlob(img, width, height, crop) {
    const options = getProcessingOptions({
        paddingPercent: 38,
        backgroundMode: backgroundMode.value === 'transparent' ? 'solid' : backgroundMode.value,
        dropShadow: true
    });
    return renderIconBlob(img, width, height, crop, options, 'png');
}

async function renderBackgroundBlob(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    fillIconBackground(ctx, width, height, getProcessingOptions({
        backgroundMode: backgroundMode.value === 'transparent' ? 'solid' : backgroundMode.value
    }), true);
    try {
        return await canvasToOutputBlob(canvas, 'image/png', undefined, `PNG ${width}x${height} background`);
    } finally {
        canvas.width = 0;
        canvas.height = 0;
    }
}

async function renderMonochromeBlob(img, width, height, crop) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    drawIconToContext(ctx, img, width, height, crop, getProcessingOptions({
        paddingPercent: Math.max(parseInt(safePaddingSlider.value, 10) || 0, 10),
        backgroundMode: 'transparent',
        effect: 'none',
        dropShadow: false
    }));
    ctx.save();
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
    try {
        return await canvasToOutputBlob(canvas, 'image/png', undefined, `Monochrome PNG ${width}x${height}`);
    } finally {
        canvas.width = 0;
        canvas.height = 0;
    }
}

async function generatePlatformBundle(img, crop, sizes, formats, operation) {
    if (activePresetKey === 'pwa') {
        await generatePwaBundle(img, crop, operation);
    } else if (activePresetKey === 'android') {
        await generateAndroidBundle(img, crop, operation);
    } else if (activePresetKey === 'ios') {
        await generateIosBundle(img, crop, operation);
    } else if (activePresetKey === 'windows') {
        await generateWindowsBundle(img, crop, operation);
    }

    if (manifestMonochromeEnabled() && ['web', 'pwa', 'all'].includes(activePresetKey)) {
        const monochromeName = activePresetKey === 'pwa'
            ? 'pwa/icons/icon-monochrome-512x512.png'
            : 'icon-monochrome-512.png';
        const monochrome = await runOperationStep(operation, 'Platform assets', monochromeName, () =>
            renderMonochromeBlob(img, 512, 512, crop)
        );
        addGeneratedFile(monochromeName, monochrome, { width: 512, height: 512 }, 'png', {
            purpose: 'monochrome',
            monochromeMethod: 'alpha-silhouette'
        });
    }
}

const PWA_ICON_SIZES = [72, 96, 128, 144, 152, 192, 384, 512];
const PWA_SPLASH_MATRIX_SOURCE = 'https://github.com/elegantapp/pwa-asset-generator/blob/master/src/config/apple-fallback-data.json';
const PWA_SPLASH_MATRIX_VERIFIED = '2026-07-25';
const ANDROID_ICON_MATRIX_SOURCE = 'https://developer.android.com/reference/android/graphics/drawable/AdaptiveIconDrawable';
const ANDROID_ICON_MATRIX_VERIFIED = '2026-07-25';
const IOS_ICON_MATRIX_SOURCE = 'https://developer.apple.com/library/archive/documentation/Xcode/Reference/xcode_ref-Asset_Catalog_Format/AppIconType.html';
const IOS_ICON_MATRIX_VERIFIED = '2026-07-25';
const PLATFORM_MATRIX_METADATA = Object.freeze({
    pwaSplash: Object.freeze({ source: PWA_SPLASH_MATRIX_SOURCE, lastVerified: PWA_SPLASH_MATRIX_VERIFIED }),
    androidIcons: Object.freeze({ source: ANDROID_ICON_MATRIX_SOURCE, lastVerified: ANDROID_ICON_MATRIX_VERIFIED }),
    iosIcons: Object.freeze({ source: IOS_ICON_MATRIX_SOURCE, lastVerified: IOS_ICON_MATRIX_VERIFIED })
});
const PWA_SPLASH_SPECS = [
    { width: 2048, height: 2732, cssWidth: 1024, cssHeight: 1366, scaleFactor: 2, name: 'ipad-pro-12-9' },
    { width: 1668, height: 2388, cssWidth: 834, cssHeight: 1194, scaleFactor: 2, name: 'ipad-pro-11' },
    { width: 1536, height: 2048, cssWidth: 768, cssHeight: 1024, scaleFactor: 2, name: 'ipad-9-7' },
    { width: 1640, height: 2360, cssWidth: 820, cssHeight: 1180, scaleFactor: 2, name: 'ipad-air-11' },
    { width: 1668, height: 2224, cssWidth: 834, cssHeight: 1112, scaleFactor: 2, name: 'ipad-air-10-5' },
    { width: 1620, height: 2160, cssWidth: 810, cssHeight: 1080, scaleFactor: 2, name: 'ipad-10-2' },
    { width: 1488, height: 2266, cssWidth: 744, cssHeight: 1133, scaleFactor: 2, name: 'ipad-mini-8-3' },
    { width: 1320, height: 2868, cssWidth: 440, cssHeight: 956, scaleFactor: 3, name: 'iphone-16-pro-max' },
    { width: 1206, height: 2622, cssWidth: 402, cssHeight: 874, scaleFactor: 3, name: 'iphone-16-pro' },
    { width: 1260, height: 2736, cssWidth: 420, cssHeight: 912, scaleFactor: 3, name: 'iphone-air' },
    { width: 1290, height: 2796, cssWidth: 430, cssHeight: 932, scaleFactor: 3, name: 'iphone-16-plus' },
    { width: 1179, height: 2556, cssWidth: 393, cssHeight: 852, scaleFactor: 3, name: 'iphone-16' },
    { width: 1170, height: 2532, cssWidth: 390, cssHeight: 844, scaleFactor: 3, name: 'iphone-16e' },
    { width: 1284, height: 2778, cssWidth: 428, cssHeight: 926, scaleFactor: 3, name: 'iphone-14-plus' },
    { width: 1125, height: 2436, cssWidth: 375, cssHeight: 812, scaleFactor: 3, name: 'iphone-13-mini' },
    { width: 1242, height: 2688, cssWidth: 414, cssHeight: 896, scaleFactor: 3, name: 'iphone-11-pro-max' },
    { width: 828, height: 1792, cssWidth: 414, cssHeight: 896, scaleFactor: 2, name: 'iphone-11' },
    { width: 1242, height: 2208, cssWidth: 414, cssHeight: 736, scaleFactor: 3, name: 'iphone-8-plus' },
    { width: 750, height: 1334, cssWidth: 375, cssHeight: 667, scaleFactor: 2, name: 'iphone-8' },
    { width: 640, height: 1136, cssWidth: 320, cssHeight: 568, scaleFactor: 2, name: 'iphone-se-4' }
].map(spec => ({
    ...spec,
    source: PWA_SPLASH_MATRIX_SOURCE,
    lastVerified: PWA_SPLASH_MATRIX_VERIFIED
}));

const WINDOWS_TILE_SPECS = [
    { width: 70, height: 70 },
    { width: 150, height: 150 },
    { width: 310, height: 310 },
    { width: 310, height: 150 }
];

const ANDROID_DENSITY_SPECS = [
    { density: 'mdpi', adaptive: 108, legacy: 48 },
    { density: 'hdpi', adaptive: 162, legacy: 72 },
    { density: 'xhdpi', adaptive: 216, legacy: 96 },
    { density: 'xxhdpi', adaptive: 324, legacy: 144 },
    { density: 'xxxhdpi', adaptive: 432, legacy: 192 }
];

async function generatePwaBundle(img, crop, operation) {
    const maskablePadding = Math.max(parseInt(safePaddingSlider.value, 10) || 0, 22);
    for (const px of PWA_ICON_SIZES) {
        const anyName = `pwa/icons/icon-${px}x${px}.png`;
        const anyBlob = await runOperationStep(operation, 'PWA icons', anyName, () =>
            hasGeneratedFile(anyName) ? null : renderIconBlob(img, px, px, crop, getProcessingOptions(), 'png')
        );
        if (anyBlob) {
            addGeneratedFile(anyName, anyBlob, { width: px, height: px }, 'png', { purpose: 'any' });
        }

        const maskName = `pwa/icons/icon-maskable-${px}x${px}.png`;
        const maskBlob = await runOperationStep(operation, 'PWA maskable icons', maskName, () =>
            renderIconBlob(img, px, px, crop, getProcessingOptions({
                paddingPercent: maskablePadding,
                backgroundMode: 'solid',
                dropShadow: false
            }), 'png')
        );
        addGeneratedFile(maskName, maskBlob, { width: px, height: px }, 'png', {
            purpose: 'maskable',
            safeZoneRadiusRatio: 0.4,
            safeZonePaddingPercent: maskablePadding,
            safeZoneBackgroundColor: normalizeSvgColor(backgroundColor.value, '#09090b')
        });
    }

    for (const splash of PWA_SPLASH_SPECS) {
        const portraitName = `pwa/splash/apple-splash-${splash.name}-${splash.width}x${splash.height}.png`;
        const portrait = await runOperationStep(operation, 'Apple startup images', portraitName, () =>
            renderSplashBlob(img, splash.width, splash.height, crop)
        );
        addGeneratedFile(portraitName, portrait, { width: splash.width, height: splash.height }, 'png', {
            role: 'splash',
            splashSpec: { ...splash, orientation: 'portrait' }
        });

        const landscapeName = `pwa/splash/apple-splash-${splash.name}-${splash.height}x${splash.width}.png`;
        const landscape = await runOperationStep(operation, 'Apple startup images', landscapeName, () =>
            renderSplashBlob(img, splash.height, splash.width, crop)
        );
        addGeneratedFile(landscapeName, landscape, { width: splash.height, height: splash.width }, 'png', {
            role: 'splash',
            splashSpec: {
                ...splash,
                cssWidth: splash.cssHeight,
                cssHeight: splash.cssWidth,
                orientation: 'landscape'
            }
        });
    }
}

async function generateAndroidBundle(img, crop, operation) {
    const foregroundOptions = getProcessingOptions({
        paddingPercent: Math.max(parseInt(safePaddingSlider.value, 10) || 0, 18),
        backgroundMode: 'transparent'
    });
    const legacyOptions = getProcessingOptions({
        paddingPercent: Math.max(parseInt(safePaddingSlider.value, 10) || 0, 12),
        backgroundMode: backgroundMode.value === 'transparent' ? 'solid' : backgroundMode.value
    });

    for (const spec of ANDROID_DENSITY_SPECS) {
        const basePath = `android/mipmap-${spec.density}`;
        const foregroundName = `${basePath}/ic_launcher_foreground.png`;
        const foreground = await runOperationStep(operation, 'Android density assets', foregroundName, () =>
            renderIconBlob(img, spec.adaptive, spec.adaptive, crop, foregroundOptions, 'png')
        );
        addGeneratedFile(foregroundName, foreground, { width: spec.adaptive, height: spec.adaptive }, 'png', {
            role: 'android-foreground',
            density: spec.density
        });

        const backgroundName = `${basePath}/ic_launcher_background.png`;
        const background = await runOperationStep(operation, 'Android density assets', backgroundName, () =>
            renderBackgroundBlob(spec.adaptive, spec.adaptive)
        );
        addGeneratedFile(backgroundName, background, { width: spec.adaptive, height: spec.adaptive }, 'png', {
            role: 'android-background',
            density: spec.density
        });

        const legacyName = `${basePath}/ic_launcher.png`;
        const legacy = await runOperationStep(operation, 'Android density assets', legacyName, () =>
            renderIconBlob(img, spec.legacy, spec.legacy, crop, legacyOptions, 'png')
        );
        addGeneratedFile(legacyName, legacy, { width: spec.legacy, height: spec.legacy }, 'png', {
            role: 'android-legacy',
            density: spec.density
        });
    }
}

const IOS_ICON_SPECS = [
    ['iphone', '20x20', '2x', 40], ['iphone', '20x20', '3x', 60],
    ['iphone', '29x29', '2x', 58], ['iphone', '29x29', '3x', 87],
    ['iphone', '40x40', '2x', 80], ['iphone', '40x40', '3x', 120],
    ['iphone', '60x60', '2x', 120], ['iphone', '60x60', '3x', 180],
    ['ipad', '20x20', '1x', 20], ['ipad', '20x20', '2x', 40],
    ['ipad', '29x29', '1x', 29], ['ipad', '29x29', '2x', 58],
    ['ipad', '40x40', '1x', 40], ['ipad', '40x40', '2x', 80],
    ['ipad', '76x76', '1x', 76], ['ipad', '76x76', '2x', 152],
    ['ipad', '83.5x83.5', '2x', 167],
    ['ios-marketing', '1024x1024', '1x', 1024]
];

function iosIconFileName(size, scale) {
    return `Icon-App-${size.replace('.', '-')}-${scale}.png`;
}

async function generateIosBundle(img, crop, operation) {
    for (const [idiom, pointSize, scale, pixels] of IOS_ICON_SPECS) {
        const name = `ios/AppIcon.appiconset/${iosIconFileName(pointSize, scale)}`;
        const blob = await runOperationStep(operation, 'iOS AppIcon set', name, () =>
            renderIconBlob(img, pixels, pixels, crop, getProcessingOptions({
                paddingPercent: Math.max(parseInt(safePaddingSlider.value, 10) || 0, 4),
                backgroundMode: backgroundMode.value === 'transparent' ? 'solid' : backgroundMode.value
            }), 'png')
        );
        addGeneratedFile(name, blob, { width: pixels, height: pixels }, 'png', { role: 'ios', idiom, pointSize, scale });
    }
}

async function generateWindowsBundle(img, crop, operation) {
    for (const tile of WINDOWS_TILE_SPECS) {
        const name = `windows/mstile-${tile.width}x${tile.height}.png`;
        const blob = await runOperationStep(operation, 'Windows tile assets', name, () =>
            hasGeneratedFile(name) ? null : renderIconBlob(img, tile.width, tile.height, crop, getProcessingOptions({
                paddingPercent: Math.max(parseInt(safePaddingSlider.value, 10) || 0, 10),
                backgroundMode: backgroundMode.value === 'transparent' ? 'solid' : backgroundMode.value
            }), 'png')
        );
        if (blob) addGeneratedFile(name, blob, tile, 'png', { role: 'windows-tile' });
    }
}

function addOutputItem(fileName, blob, size, format, icoSizes = null, fileSize = 0) {
    const item = document.createElement('div');
    item.className = 'output-item';

    const blobUrl = URL.createObjectURL(blob);
    const sizeText = size.width === 'multi'
        ? icoSizes.map(s => `${s.width}`).join(', ')
        : size.width === 'svg' ? 'Scalable' : `${size.width}x${size.height}`;

    const safeName = escapeHtml(fileName);
    const shortName = escapeHtml(baseName(fileName));
    const sizeDisplay = fileSize > 0 ? `<br><span class="output-file-size">${formatFileSize(fileSize)}</span>` : '';

    item.innerHTML = `
        <div class="output-preview">
            <img src="${blobUrl}" alt="${safeName}">
        </div>
        <div class="output-info" title="${safeName}">${shortName}<br>${sizeText}<br>${format.toUpperCase()}${sizeDisplay}</div>
        <button class="btn-download" data-filename="${safeName}">Download</button>
        <div class="base64-section">
            <div class="base64-container">
                <button class="btn-copy" title="Copy base64 data URL">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                    Copy Base64
                </button>
            </div>
        </div>
    `;

    item.querySelector('.btn-download').addEventListener('click', () => {
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = fileName;
        link.click();
    });

    item.querySelector('.btn-copy').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        try {
            const dataUrl = await blobToDataURL(blob);
            await navigator.clipboard.writeText(dataUrl);
            showCopyFeedback(btn);
        } catch {
            showStatus('Failed to copy — clipboard requires HTTPS', 'error');
        }
    });

    outputGrid.appendChild(item);
}

function showCopyFeedback(button) {
    const originalText = button.innerHTML;
    button.classList.add('copied');
    button.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        Copied!
    `;
    setTimeout(() => {
        button.classList.remove('copied');
        button.innerHTML = originalText;
    }, 1500);
}


const ASSET_URL_MODES = new Set(['root', 'relative', 'custom']);
const ASSET_BASE_SCHEME = /^[a-zA-Z][a-zA-Z\d+.-]*:/;
const UNSAFE_ASSET_BASE_CHARS = /[\u0000-\u001F\u007F"'<>`\\]/;

function assetPathFor(name) {
    return normalizedFileName(name).replace(/^\/+/, '');
}

function inspectAssetBase(base) {
    const value = String(base || '').trim();
    if (!value) {
        return { valid: false, normalized: '', error: 'Enter a custom asset base.' };
    }
    if (UNSAFE_ASSET_BASE_CHARS.test(value) || /\s/.test(value)) {
        return { valid: false, normalized: '', error: 'Custom asset bases cannot contain whitespace, controls, quotes, markup, or backslashes.' };
    }
    if (value.startsWith('//')) {
        return { valid: false, normalized: '', error: 'Protocol-relative asset bases are not allowed. Use https:// or a relative path.' };
    }

    if (ASSET_BASE_SCHEME.test(value)) {
        let parsed;
        try {
            parsed = new URL(value);
        } catch {
            return { valid: false, normalized: '', error: 'Custom asset base must be a valid HTTP(S) URL or relative path.' };
        }
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return { valid: false, normalized: '', error: 'Custom asset base URLs must use http:// or https://.' };
        }
        if (parsed.username || parsed.password) {
            return { valid: false, normalized: '', error: 'Custom asset base URLs cannot contain credentials.' };
        }
        if (parsed.search || parsed.hash) {
            return { valid: false, normalized: '', error: 'Custom asset bases cannot contain a query string or fragment.' };
        }
        parsed.pathname = parsed.pathname.endsWith('/') ? parsed.pathname : `${parsed.pathname}/`;
        return { valid: true, normalized: parsed.href, error: '' };
    }

    if (value.includes('?') || value.includes('#') || /%(?![0-9a-fA-F]{2})/.test(value)) {
        return { valid: false, normalized: '', error: 'Relative asset bases cannot contain queries, fragments, or malformed percent escapes.' };
    }
    return {
        valid: true,
        normalized: value.endsWith('/') ? value : `${value}/`,
        error: ''
    };
}

function normalizeAssetBase(base) {
    const result = inspectAssetBase(base);
    if (!result.valid) throw new Error(result.error);
    return result.normalized;
}

function getDeploymentUrlOptions() {
    const mode = ASSET_URL_MODES.has(assetUrlMode?.value) ? assetUrlMode.value : 'root';
    return {
        mode,
        customBase: metadataValue(assetUrlBase),
        cacheBust: Boolean(cacheBustToggle?.checked)
    };
}

function deploymentUrlFor(name, options = {}) {
    const path = assetPathFor(name);
    const deployment = getDeploymentUrlOptions();
    let url = `/${path}`;
    if (deployment.mode === 'relative') {
        url = path;
    } else if (deployment.mode === 'custom') {
        url = `${normalizeAssetBase(deployment.customBase)}${path}`;
    }

    if (options.cacheBust !== false && deployment.cacheBust) {
        const hash = assetCacheBusters.get(path);
        if (hash) url += `${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(hash)}`;
    }
    return url;
}

function hrefFor(name) {
    return deploymentUrlFor(name);
}

function validateDeploymentUrlOptions() {
    const deployment = getDeploymentUrlOptions();
    const customBase = deployment.mode === 'custom'
        ? inspectAssetBase(deployment.customBase)
        : { valid: true, normalized: '', error: '' };
    const result = {
        ...deployment,
        valid: customBase.valid,
        normalizedBase: customBase.normalized,
        error: customBase.error
    };
    if (!deploymentUrlStatus) return result;
    const modeLabel = deployment.mode === 'relative'
        ? 'Relative URLs'
        : deployment.mode === 'custom'
            ? customBase.valid
                ? `Custom base: ${customBase.normalized}`
                : customBase.error
            : 'Root-relative URLs';
    deploymentUrlStatus.textContent = deployment.cacheBust ? `${modeLabel}, SHA-256 queries` : modeLabel;
    deploymentUrlStatus.classList.toggle('error', !customBase.valid);
    return result;
}

async function refreshAssetCacheBusters() {
    assetCacheBusters = new Map();
    if (!getDeploymentUrlOptions().cacheBust) return;
    for (const file of generatedFiles) {
        if (!file.blob) continue;
        assetCacheBusters.set(assetPathFor(file.name), (await sha256Hex(file.blob)).slice(0, 8));
    }
}

function firstFile(predicate) {
    return generatedFiles.find(predicate);
}

function setSnippetBlock(blockId, snippetId, value) {
    const block = document.getElementById(blockId);
    const snippet = document.getElementById(snippetId);
    if (!value) {
        setElementVisible(block, false);
        snippet.textContent = '';
        return;
    }
    setElementVisible(block, true, 'block');
    snippet.textContent = value;
}

const MANIFEST_DISPLAY_MODES = new Set(['fullscreen', 'standalone', 'minimal-ui', 'browser']);
const MANIFEST_DIRECTIONS = new Set(['auto', 'ltr', 'rtl']);
const MANIFEST_TEST_BASE = 'https://iconforge.invalid/app/manifest.webmanifest';

function metadataValue(field) {
    return (field?.value || '').trim();
}

function getManifestSourceName() {
    return cleanPathSegment(sourceFileName || 'IconForge App') || 'IconForge-App';
}

function parseJsonArrayField(field, label, errors) {
    const raw = metadataValue(field);
    if (!raw) return undefined;

    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            errors.push(`${label} must be a JSON array.`);
            return undefined;
        }
        return parsed;
    } catch {
        errors.push(`${label} must be valid JSON.`);
        return undefined;
    }
}

function isValidLanguageTag(value) {
    if (!value) return true;
    try {
        return Intl.getCanonicalLocales(value).length === 1;
    } catch {
        return false;
    }
}

function parseManifestPath(value, label, errors, options = {}) {
    if (!value) return null;
    if (UNSAFE_ASSET_BASE_CHARS.test(value) || /\s/.test(value) || value.startsWith('//') || ASSET_BASE_SCHEME.test(value)) {
        errors.push(`${label} must be a safe relative or root-relative URL.`);
        return null;
    }
    let parsed;
    try {
        parsed = new URL(value, MANIFEST_TEST_BASE);
    } catch {
        errors.push(`${label} must be a valid relative or root-relative URL.`);
        return null;
    }
    if (parsed.origin !== new URL(MANIFEST_TEST_BASE).origin) {
        errors.push(`${label} must remain on the manifest origin.`);
        return null;
    }
    if (options.allowQuery === false && parsed.search) errors.push(`${label} cannot contain a query string.`);
    if (parsed.hash) errors.push(`${label} cannot contain a fragment.`);
    return parsed;
}

function parseManifestResourceUrl(value, label, errors) {
    if (!value || UNSAFE_ASSET_BASE_CHARS.test(value) || /\s/.test(value) || value.startsWith('//')) {
        errors.push(`${label} must be a safe relative, root-relative, or HTTP(S) URL.`);
        return null;
    }
    if (ASSET_BASE_SCHEME.test(value) && !/^https?:/i.test(value)) {
        errors.push(`${label} must use http://, https://, or a relative URL.`);
        return null;
    }
    try {
        const parsed = new URL(value, MANIFEST_TEST_BASE);
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
        return parsed;
    } catch {
        errors.push(`${label} must be a valid URL without credentials.`);
        return null;
    }
}

function validateManifestCollections(shortcuts, screenshots, scopeUrl, errors) {
    if (shortcuts) {
        shortcuts.forEach((shortcut, index) => {
            const label = `Shortcut ${index + 1}`;
            if (!shortcut || typeof shortcut !== 'object' || Array.isArray(shortcut)) {
                errors.push(`${label} must be an object.`);
                return;
            }
            if (typeof shortcut.name !== 'string' || !shortcut.name.trim()) errors.push(`${label} needs a name.`);
            if (typeof shortcut.url !== 'string' || !shortcut.url.trim()) {
                errors.push(`${label} needs a URL.`);
                return;
            }
            const shortcutUrl = parseManifestPath(shortcut.url.trim(), `${label} URL`, errors);
            if (shortcutUrl && scopeUrl) {
                const scopePath = scopeUrl.pathname.endsWith('/') ? scopeUrl.pathname : `${scopeUrl.pathname}/`;
                if (shortcutUrl.pathname !== scopeUrl.pathname && !shortcutUrl.pathname.startsWith(scopePath)) {
                    errors.push(`${label} URL must stay within manifest scope.`);
                }
            }
        });
    }

    if (screenshots) {
        screenshots.forEach((screenshot, index) => {
            const label = `Screenshot ${index + 1}`;
            if (!screenshot || typeof screenshot !== 'object' || Array.isArray(screenshot)) {
                errors.push(`${label} must be an object.`);
                return;
            }
            if (typeof screenshot.src !== 'string' || !screenshot.src.trim()) {
                errors.push(`${label} needs a src URL.`);
            } else {
                parseManifestResourceUrl(screenshot.src.trim(), `${label} src`, errors);
            }
            if (screenshot.sizes !== undefined && (typeof screenshot.sizes !== 'string' || !/^(?:any|\d+x\d+)(?:\s+(?:any|\d+x\d+))*$/i.test(screenshot.sizes.trim()))) {
                errors.push(`${label} sizes must contain dimensions such as 1280x720.`);
            }
            if (screenshot.type !== undefined && (typeof screenshot.type !== 'string' || !/^image\/[a-z0-9.+-]+$/i.test(screenshot.type))) {
                errors.push(`${label} type must be an image MIME type.`);
            }
            if (screenshot.form_factor !== undefined && !['wide', 'narrow'].includes(screenshot.form_factor)) {
                errors.push(`${label} form_factor must be wide or narrow.`);
            }
        });
    }
}

function getManifestMetadata() {
    const errors = [];
    const sourceName = getManifestSourceName();
    const name = metadataValue(manifestName) || sourceName;
    const shortName = metadataValue(manifestShortName) || name.slice(0, 12);
    const id = metadataValue(manifestId);
    const description = metadataValue(manifestDescription) || `Generated icon set for ${name}.`;
    const startUrl = metadataValue(manifestStartUrl) || './index.html';
    const scope = metadataValue(manifestScope) || './';
    const display = metadataValue(manifestDisplay) || 'standalone';
    const themeColor = metadataValue(manifestThemeColor) || backgroundColor.value;
    const backgroundManifestColor = metadataValue(manifestBackgroundColor) || backgroundColor.value;
    const lang = metadataValue(manifestLang);
    const dir = metadataValue(manifestDir);
    const categories = metadataValue(manifestCategories)
        .split(',')
        .map(category => category.trim())
        .filter(Boolean);
    const shortcuts = parseJsonArrayField(manifestShortcuts, 'Shortcuts', errors);
    const screenshots = parseJsonArrayField(manifestScreenshots, 'Screenshots', errors);

    if (!name) errors.push('Name is required.');
    if (!shortName) errors.push('Short name is required.');
    if (!startUrl) errors.push('Start URL is required.');
    if (!scope) errors.push('Scope is required.');
    if (!MANIFEST_DISPLAY_MODES.has(display)) errors.push('Display must be fullscreen, standalone, minimal-ui, or browser.');
    if (dir && !MANIFEST_DIRECTIONS.has(dir)) errors.push('Direction must be auto, ltr, or rtl.');
    if (lang && !isValidLanguageTag(lang)) errors.push('Language must be a valid BCP 47 tag, such as en or pt-BR.');

    const startUrlParsed = parseManifestPath(startUrl, 'Start URL', errors);
    const scopeParsed = parseManifestPath(scope, 'Scope', errors, { allowQuery: false });
    if (id) parseManifestPath(id, 'ID', errors);
    if (startUrlParsed && scopeParsed) {
        const scopePath = scopeParsed.pathname.endsWith('/') ? scopeParsed.pathname : `${scopeParsed.pathname}/`;
        if (startUrlParsed.pathname !== scopeParsed.pathname && !startUrlParsed.pathname.startsWith(scopePath)) {
            errors.push('Start URL must stay within manifest scope.');
        }
    }
    validateManifestCollections(shortcuts, screenshots, scopeParsed, errors);

    const metadata = {
        name,
        short_name: shortName,
        description,
        start_url: startUrl,
        scope,
        display,
        theme_color: themeColor,
        background_color: backgroundManifestColor
    };

    if (id) metadata.id = id;
    if (categories.length) metadata.categories = categories;
    if (lang) metadata.lang = lang;
    if (dir) metadata.dir = dir;
    if (shortcuts) metadata.shortcuts = shortcuts;
    if (screenshots) metadata.screenshots = screenshots;

    return { metadata, errors };
}

function validateManifestMetadata() {
    const result = getManifestMetadata();
    if (manifestMetadataStatus) {
        manifestMetadataStatus.textContent = result.errors.length
            ? result.errors[0]
            : `Manifest ready: ${result.metadata.name}`;
        manifestMetadataStatus.classList.toggle('error', result.errors.length > 0);
    }
    return result;
}

if (manifestMetadataGrid) {
    const handleManifestMetadataChange = async () => {
        const result = validateManifestMetadata();
        queueDraftSave();
        if (generatedFiles.length === 0) return;
        try {
            await generateSnippets(getSelectedSizes(), getSelectedFormats());
            const validationResult = await renderExportValidation();
            renderGenerationDiagnostics({ validationResult });
        } catch (error) {
            renderGenerationDiagnostics({ error });
            showStatus(`Manifest update failed: ${error.message}`, 'error');
        }
    };
    manifestMetadataGrid.addEventListener('input', handleManifestMetadataChange);
    manifestMetadataGrid.addEventListener('change', handleManifestMetadataChange);
    validateManifestMetadata();
}

async function handleDeploymentUrlChange() {
    const validation = validateDeploymentUrlOptions();
    queueDraftSave();
    if (!validation.valid) return;
    if (generatedFiles.length === 0) return;
    try {
        await generateSnippets(getSelectedSizes(), getSelectedFormats());
        const validationResult = await renderExportValidation();
        renderGenerationDiagnostics({ validationResult });
    } catch (error) {
        renderGenerationDiagnostics({ error });
        showStatus(`Deployment URL update failed: ${error.message}`, 'error');
    }
}

if (deploymentUrlGrid) {
    deploymentUrlGrid.addEventListener('input', handleDeploymentUrlChange);
    deploymentUrlGrid.addEventListener('change', handleDeploymentUrlChange);
    validateDeploymentUrlOptions();
}

function manifestIconFiles() {
    return generatedFiles
        .filter(file => file.format === 'png' && file.size && file.size.width === file.size.height)
        .filter(file => file.name.startsWith('pwa/') || file.name === 'icon-192.png' || file.name === 'icon-512.png' || [192, 512].includes(file.size.width));
}

function manifestIconEntry(file, purpose = file.purpose || (file.name.includes('maskable') ? 'maskable' : 'any')) {
    return {
        src: hrefFor(file.name),
        sizes: `${file.size.width}x${file.size.height}`,
        type: 'image/png',
        purpose
    };
}

function manifestMonochromeEnabled() {
    return Boolean(manifestMonochrome?.checked);
}

function monochromeManifestIconFile(files = manifestIconFiles()) {
    return files
        .filter(file => file.purpose === 'monochrome')
        .sort((a, b) => b.size.width - a.size.width)[0] || null;
}

function buildManifestSnippet() {
    const iconFiles = manifestIconFiles();
    const icons = iconFiles
        .filter(file => file.purpose !== 'monochrome')
        .map(file => manifestIconEntry(file));
    if (manifestMonochromeEnabled()) {
        const monochromeFile = monochromeManifestIconFile(iconFiles);
        if (monochromeFile) icons.push(manifestIconEntry(monochromeFile, 'monochrome'));
    }

    if (icons.length === 0) return '';
    const result = validateManifestMetadata();
    if (result.errors.length) return '';
    const { metadata } = result;
    return JSON.stringify({
        ...metadata,
        icons
    }, null, 2);
}

function buildExtensionSnippet() {
    if (activePresetKey !== 'extension' && activePresetKey !== 'all') return '';
    const icons = {};
    for (const size of [16, 32, 48, 128]) {
        const file = firstFile(f => f.format === 'png' && f.size?.width === size && f.size?.height === size);
        if (file) icons[size] = file.name.startsWith('extension/') ? file.name.replace(/^extension\//, '') : file.name;
    }
    return Object.keys(icons).length > 0 ? JSON.stringify({ icons }, null, 2) : '';
}

function buildAndroidSnippet() {
    if (activePresetKey !== 'android') return '';
    return `<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>`;
}

function buildIosContents() {
    if (activePresetKey !== 'ios') return '';
    const images = IOS_ICON_SPECS.map(([idiom, pointSize, scale]) => ({
        idiom,
        size: pointSize,
        scale,
        filename: iosIconFileName(pointSize, scale)
    }));
    return JSON.stringify({ images, info: { version: 1, author: 'xcode' } }, null, 2);
}

function buildWindowsBrowserConfig() {
    if (activePresetKey !== 'windows') return '';
    return `<?xml version="1.0" encoding="utf-8"?>
<browserconfig>
  <msapplication>
    <tile>
      <square70x70logo src="${escapeAttribute(hrefFor('windows/mstile-70x70.png'))}"/>
      <square150x150logo src="${escapeAttribute(hrefFor('windows/mstile-150x150.png'))}"/>
      <wide310x150logo src="${escapeAttribute(hrefFor('windows/mstile-310x150.png'))}"/>
      <square310x310logo src="${escapeAttribute(hrefFor('windows/mstile-310x310.png'))}"/>
      <TileColor>${backgroundColor.value}</TileColor>
    </tile>
  </msapplication>
</browserconfig>`;
}

function escapeAttribute(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function normalizedFileName(name) {
    return name.replace(/\\/g, '/');
}

function getSocialPreviewFiles() {
    return {
        og: firstFile(file => file.name === 'social/og-image.png') || firstFile(file => file.role === 'social'),
        twitter: firstFile(file => file.name === 'social/twitter-card.png') || firstFile(file => file.name === 'social/og-image.png') || firstFile(file => file.role === 'social'),
        linkedin: firstFile(file => file.name === 'social/linkedin-preview.png')
    };
}

function buildSocialSnippet() {
    const social = getSocialPreviewFiles();
    if (!social.og && !social.twitter && !social.linkedin) return '';
    const { metadata } = getManifestMetadata();
    const title = escapeAttribute(metadata.name || getManifestSourceName());
    const description = escapeAttribute(metadata.description || `Generated icon set for ${metadata.name || getManifestSourceName()}.`);
    const alt = escapeAttribute(`${metadata.name || getManifestSourceName()} social preview`);
    const og = social.og || social.twitter || social.linkedin;
    const twitter = social.twitter || og;
    const lines = [
        `<meta property="og:title" content="${title}">`,
        `<meta property="og:description" content="${description}">`,
        '<meta property="og:type" content="website">',
        `<meta property="og:image" content="${escapeAttribute(hrefFor(og.name))}">`,
        `<meta property="og:image:width" content="${og.size.width}">`,
        `<meta property="og:image:height" content="${og.size.height}">`,
        `<meta property="og:image:alt" content="${alt}">`,
        '<meta name="twitter:card" content="summary_large_image">',
        `<meta name="twitter:title" content="${title}">`,
        `<meta name="twitter:description" content="${description}">`,
        `<meta name="twitter:image" content="${escapeAttribute(hrefFor(twitter.name))}">`
    ];
    return lines.join('\n');
}

function generatedFileCopyList(prefix = '') {
    if (generatedFiles.length === 0) return uiText('snippets.noGeneratedFiles');
    return generatedFiles
        .map(file => `- ${prefix}${normalizedFileName(file.name)}`)
        .join('\n');
}

function webManifestHref(manifest) {
    if (!manifest) return '';
    return deploymentUrlFor(activePresetKey === 'pwa' ? 'pwa/manifest.webmanifest' : 'manifest.webmanifest', { cacheBust: false });
}

function startupImageMediaFor(file) {
    const spec = file.splashSpec;
    if (!spec) {
        return `(device-width: ${file.size.width}px) and (device-height: ${file.size.height}px)`;
    }
    return [
        `(device-width: ${spec.cssWidth}px)`,
        `(device-height: ${spec.cssHeight}px)`,
        `(-webkit-device-pixel-ratio: ${spec.scaleFactor})`,
        `(orientation: ${spec.orientation})`
    ].join(' and ');
}

function squarePngFiles() {
    return generatedFiles
        .filter(file => file.format === 'png' && file.size?.width === file.size?.height && file.role !== 'splash')
        .sort((a, b) => a.size.width - b.size.width);
}

function preferredAppleFile() {
    return firstFile(file => file.format === 'png' && file.size?.width === 180 && file.size?.height === 180) ||
        firstFile(file => file.format === 'png' && file.size?.width === 152 && file.size?.height === 152);
}

function buildPlainHtmlHandoff(html) {
    return `<!-- Plain HTML: paste into <head> -->\n${html || uiText('snippets.noApplicableTags')}`;
}

function buildViteHandoffSnippet(html, manifest) {
    const manifestPath = webManifestHref(manifest).replace(/^\//, '');
    const supportFiles = manifestPath ? `\n- public/${manifestPath}` : '';
    return `# Vite public/ handoff
Copy the generated files into public/ with these paths:
${generatedFileCopyList('public/')}${supportFiles}

Add the generated tags to index.html:
${html || uiText('snippets.noApplicableTags')}`;
}

function nextIconEntry(file) {
    const parts = [`url: '${hrefFor(file.name)}'`];
    if (file.size?.width && file.size?.height) parts.push(`sizes: '${file.size.width}x${file.size.height}'`);
    if (file.format === 'svg') parts.push("type: 'image/svg+xml'");
    if (file.format === 'png') parts.push("type: 'image/png'");
    if (file.format === 'ico') parts.push("type: 'image/x-icon'");
    return `      { ${parts.join(', ')} }`;
}

function buildNextHandoffSnippet(manifest) {
    const iconFiles = [
        firstFile(file => file.format === 'ico'),
        firstFile(file => file.format === 'svg'),
        ...squarePngFiles().filter(file => file.purpose !== 'maskable').slice(-4)
    ].filter(Boolean);
    const apple = preferredAppleFile();
    const lines = [
        '// app/layout.tsx',
        "import type { Metadata } from 'next';",
        '',
        'export const metadata: Metadata = {'
    ];
    const manifestHref = webManifestHref(manifest);
    if (manifestHref) lines.push(`  manifest: '${manifestHref}',`);
    lines.push('  icons: {');
    lines.push('    icon: [');
    lines.push(iconFiles.length ? iconFiles.map(nextIconEntry).join(',\n') : "      { url: '/favicon.ico' }");
    lines.push('    ],');
    if (apple) {
        lines.push('    apple: [');
        lines.push(`      { url: '${hrefFor(apple.name)}', sizes: '${apple.size.width}x${apple.size.height}', type: 'image/png' }`);
        lines.push('    ],');
    }
    lines.push('  },');
    lines.push('};');
    return lines.join('\n');
}

function buildAstroHandoffSnippet(html) {
    const head = html || '<!-- No applicable tags for selected formats -->';
    const indentedHead = head.split('\n').map(line => `    ${line}`).join('\n');
    return `---
// src/layouts/BaseLayout.astro
---
<html lang="en">
  <head>
${indentedHead}
  </head>
  <body>
    <slot />
  </body>
</html>`;
}

function extensionIconMap() {
    const icons = {};
    for (const size of [16, 32, 48, 128]) {
        const file = firstFile(f => f.format === 'png' && f.size?.width === size && f.size?.height === size);
        if (file) {
            icons[size] = file.name.startsWith('extension/')
                ? normalizedFileName(file.name).replace(/^extension\//, '')
                : normalizedFileName(file.name);
        }
    }
    return icons;
}

function buildMv3HandoffSnippet(target) {
    const icons = extensionIconMap();
    const manifest = {
        manifest_version: 3,
        name: getManifestSourceName(),
        version: '1.0.0',
        icons
    };
    if (Object.keys(icons).length) {
        manifest.action = { default_icon: icons };
    }
    if (target === 'firefox') {
        manifest.browser_specific_settings = {
            gecko: {
                id: `${getManifestSourceName().toLowerCase()}@example.com`
            }
        };
    }
    return JSON.stringify(manifest, null, 2);
}

function buildAndroidHandoffSnippet() {
    const files = generatedFiles.filter(file => normalizedFileName(file.name).startsWith('android/'));
    if (files.length === 0) {
        return uiText('snippets.androidMissing');
    }
    const fileLines = files
        .map(file => `- ${normalizedFileName(file.name)} -> app/src/main/res/${normalizedFileName(file.name).replace(/^android\//, '')}`)
        .join('\n');
    return `Copy generated Android files:
${fileLines}

// app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml
${buildAndroidSnippet()}`;
}

function buildIosHandoffSnippet() {
    const files = generatedFiles.filter(file => normalizedFileName(file.name).startsWith('ios/AppIcon.appiconset/'));
    if (files.length === 0) {
        return uiText('snippets.iosMissing');
    }
    return `Copy generated iOS files into Xcode:
${files.map(file => `- ${normalizedFileName(file.name)}`).join('\n')}

// ios/AppIcon.appiconset/Contents.json
${buildIosContents()}`;
}

function buildFrameworkHandoffSnippets(html, manifest) {
    return {
        plain: buildPlainHtmlHandoff(html),
        vite: buildViteHandoffSnippet(html, manifest),
        next: buildNextHandoffSnippet(manifest),
        astro: buildAstroHandoffSnippet(html),
        chrome: buildMv3HandoffSnippet('chrome'),
        firefox: buildMv3HandoffSnippet('firefox'),
        android: buildAndroidHandoffSnippet(),
        ios: buildIosHandoffSnippet()
    };
}

function renderHandoffSnippetTabs() {
    const snippets = generatedSnippets.handoff || {};
    if (!handoffTabs || !handoffSnippet || !handoffSnippetTitle) return;
    if (!snippets[activeHandoffSnippetKey]) activeHandoffSnippetKey = 'plain';
    const tabMeta = getHandoffTabMeta(activeHandoffSnippetKey) || HANDOFF_SNIPPET_TABS[0];

    handoffTabs.querySelectorAll('[data-handoff-tab]').forEach(tab => {
        const active = tab.dataset.handoffTab === tabMeta.key;
        const meta = getHandoffTabMeta(tab.dataset.handoffTab);
        if (meta) tab.id = meta.tabId;
        tab.setAttribute('aria-controls', handoffSnippet.id);
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
        tab.setAttribute('tabindex', active ? '0' : '-1');
    });

    handoffSnippetTitle.textContent = tabMeta.label;
    handoffSnippet.setAttribute('aria-labelledby', tabMeta.tabId);
    handoffSnippet.setAttribute('tabindex', '0');
    handoffSnippet.textContent = snippets[tabMeta.key] || '';
}

async function generateSnippets(sizes, formats) {
    const snippetSection = document.getElementById('snippetSection');
    const htmlSnippet = document.getElementById('htmlSnippet');
    await refreshAssetCacheBusters();
    const lines = [];
    const icoFile = firstFile(file => file.format === 'ico');
    const svgFile = firstFile(file => file.format === 'svg');
    const appleFile = firstFile(file => file.format === 'png' && file.size?.width === 180 && file.size?.height === 180);
    const manifest = buildManifestSnippet();
    const splashFiles = generatedFiles.filter(file => file.role === 'splash');
    const social = buildSocialSnippet();

    if (icoFile) lines.push(`<link rel="icon" href="${escapeAttribute(hrefFor(icoFile.name))}" sizes="32x32">`);
    if (svgFile) lines.push(`<link rel="icon" href="${escapeAttribute(hrefFor(svgFile.name))}" type="image/svg+xml">`);
    if (appleFile) lines.push(`<link rel="apple-touch-icon" href="${escapeAttribute(hrefFor(appleFile.name))}">`);
    if (manifest) lines.push(`<link rel="manifest" href="${escapeAttribute(webManifestHref(manifest))}">`);
    for (const splash of splashFiles) {
        lines.push(`<link rel="apple-touch-startup-image" href="${escapeAttribute(hrefFor(splash.name))}" media="${startupImageMediaFor(splash)}">`);
    }
    if (activePresetKey === 'windows') {
        lines.push(`<meta name="msapplication-config" content="${escapeAttribute(deploymentUrlFor('windows/browserconfig.xml', { cacheBust: false }))}">`);
    }
    if (social) lines.push(social);

    const html = lines.join('\n') || '<!-- No applicable tags for selected formats -->';
    generatedSnippets = {
        html,
        manifest,
        social,
        extension: buildExtensionSnippet(),
        android: buildAndroidSnippet(),
        ios: buildIosContents(),
        windows: buildWindowsBrowserConfig(),
        handoff: buildFrameworkHandoffSnippets(html, manifest)
    };

    htmlSnippet.textContent = generatedSnippets.html;
    setElementVisible(snippetSection, true, 'block');
    renderHandoffSnippetTabs();
    setSnippetBlock('manifestSnippetBlock', 'manifestSnippet', generatedSnippets.manifest);
    setSnippetBlock('socialSnippetBlock', 'socialSnippet', generatedSnippets.social);
    setSnippetBlock('extensionSnippetBlock', 'extensionSnippet', generatedSnippets.extension);
    setSnippetBlock('androidSnippetBlock', 'androidSnippet', generatedSnippets.android);
    setSnippetBlock('iosSnippetBlock', 'iosSnippet', generatedSnippets.ios);
    setSnippetBlock('windowsSnippetBlock', 'windowsSnippet', generatedSnippets.windows);
}

document.getElementById('btnCopyHtml').addEventListener('click', async function() {
    try {
        await navigator.clipboard.writeText(document.getElementById('htmlSnippet').textContent);
        showCopyFeedback(this);
    } catch { showStatus('Failed to copy', 'error'); }
});

document.getElementById('btnCopyManifest').addEventListener('click', async function() {
    try {
        await navigator.clipboard.writeText(document.getElementById('manifestSnippet').textContent);
        showCopyFeedback(this);
    } catch { showStatus('Failed to copy', 'error'); }
});

document.getElementById('snippetSection').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-copy-target]');
    if (!btn) return;
    try {
        await navigator.clipboard.writeText(document.getElementById(btn.dataset.copyTarget).textContent);
        showCopyFeedback(btn);
    } catch {
        showStatus('Failed to copy', 'error');
    }
});

function textSupportFile(name, text, type = 'text/plain') {
    return { name, blob: new Blob([text], { type }), support: true };
}

function getSupportFiles() {
    const support = [];
    const manifestPath = activePresetKey === 'pwa' ? 'pwa/manifest.webmanifest' : 'manifest.webmanifest';
    if (generatedSnippets.html) support.push(textSupportFile('snippets/head.html', generatedSnippets.html, 'text/html'));
    if (generatedSnippets.manifest) support.push(textSupportFile(manifestPath, generatedSnippets.manifest, 'application/manifest+json'));
    if (generatedSnippets.social) support.push(textSupportFile('snippets/social-meta.html', generatedSnippets.social, 'text/html'));
    if (generatedSnippets.extension) support.push(textSupportFile('extension/manifest-icons.json', generatedSnippets.extension, 'application/json'));
    if (generatedSnippets.android) support.push(textSupportFile('android/mipmap-anydpi-v26/ic_launcher.xml', generatedSnippets.android, 'application/xml'));
    if (generatedSnippets.ios) support.push(textSupportFile('ios/AppIcon.appiconset/Contents.json', generatedSnippets.ios, 'application/json'));
    if (generatedSnippets.windows) support.push(textSupportFile('windows/browserconfig.xml', generatedSnippets.windows, 'application/xml'));

    const fileList = generatedFiles.map(file => `- ${file.name} (${formatFileSize(file.blob.size)})`).join('\n');
    support.push(textSupportFile('README.txt', `Icon Forge export\n\nGenerated files:\n${fileList}\n`, 'text/plain'));
    return support;
}

function mimeTypeForFile(file) {
    if (file.blob?.type) return file.blob.type;
    if (file.format === 'png') return 'image/png';
    if (file.format === 'jpg') return 'image/jpeg';
    if (file.format === 'webp') return 'image/webp';
    if (file.format === 'avif') return 'image/avif';
    if (file.format === 'svg') return 'image/svg+xml';
    if (file.format === 'ico') return 'image/x-icon';
    return 'application/octet-stream';
}

function dimensionsForFile(file) {
    if (!file.size) return null;
    return {
        width: file.size.width,
        height: file.size.height
    };
}

async function sha256Hex(blob) {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new Error('SHA-256 hashing is unavailable in this browser.');
    const hash = await subtle.digest('SHA-256', await blob.arrayBuffer());
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

function getExportOptionsSnapshot() {
    const manifest = getManifestMetadata();
    return {
        sizes: getSelectedSizes(),
        formats: getSelectedFormats(),
        processing: {
            ...getProcessingOptions(),
            lossyQuality: getLossyQuality(),
            lossyQualityPercent: getLossyQualityPercent(),
            sizeBudgetBytes: getSizeBudgetBytes()
        },
        replacementTemplate: {
            active: replacementTargetNames.size > 0,
            targets: Array.from(replacementTargetNames).sort()
        },
        deploymentUrls: getDeploymentUrlOptions(),
        manifestMetadata: manifest.metadata,
        manifestMetadataErrors: manifest.errors
    };
}

async function exportManifestRecord(file) {
    return {
        name: normalizedFileName(file.name),
        kind: file.support ? 'support' : 'image',
        format: file.format || null,
        role: file.role || file.purpose || null,
        dimensions: dimensionsForFile(file),
        mimeType: mimeTypeForFile(file),
        byteSize: file.blob?.size || 0,
        sha256: await sha256Hex(file.blob)
    };
}

async function buildExportManifest(exportFiles) {
    return {
        schema: 'iconforge-export-v1',
        version: APP_VERSION,
        createdAt: new Date().toISOString(),
        preset: activePresetKey || 'custom',
        source: {
            mode: sourceMode,
            name: sourceFileName || null
        },
        options: getExportOptionsSnapshot(),
        files: await Promise.all(exportFiles.map(exportManifestRecord))
    };
}

async function getExportFilesWithManifest() {
    const exportFiles = getExportFiles();
    const manifest = await buildExportManifest(exportFiles);
    return [
        ...exportFiles,
        textSupportFile('iconforge-export.json', JSON.stringify(manifest, null, 2), 'application/json')
    ];
}

function pwaSplashFileSpecs() {
    return PWA_SPLASH_SPECS.flatMap(splash => [
        {
            name: `pwa/splash/apple-splash-${splash.name}-${splash.width}x${splash.height}.png`,
            width: splash.width,
            height: splash.height
        },
        {
            name: `pwa/splash/apple-splash-${splash.name}-${splash.height}x${splash.width}.png`,
            width: splash.height,
            height: splash.width
        }
    ]);
}

function fileSpecSummary(items) {
    if (items.length === 0) return '';
    const shown = items.slice(0, 4).join(', ');
    return items.length > 4 ? `${shown}, +${items.length - 4} more` : shown;
}

function getFileByName(name) {
    return generatedFiles.find(file => file.name === name);
}

function catalogValidationLabel(label) {
    return Object.values(UI_STRINGS.validation.labels).find(value => value === label) || label;
}

function addValidationCheck(checks, status, label, detail) {
    checks.push({ status, label: catalogValidationLabel(label), detail });
}

function artifactMimeType(format) {
    return {
        png: 'image/png',
        ico: 'image/x-icon',
        svg: 'image/svg+xml',
        jpg: 'image/jpeg',
        webp: 'image/webp',
        avif: 'image/avif'
    }[format] || '';
}

function asciiAt(bytes, offset, value) {
    if (offset < 0 || offset + value.length > bytes.length) return false;
    return Array.from(value).every((char, index) => bytes[offset + index] === char.charCodeAt(0));
}

function findAscii(bytes, value) {
    for (let offset = 0; offset <= bytes.length - value.length; offset++) {
        if (asciiAt(bytes, offset, value)) return offset;
    }
    return -1;
}

function inspectArtifactBytes(file, bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const fail = error => ({ valid: false, error, width: null, height: null, icoSizes: [] });
    if (bytes.length === 0) return fail('file is empty');

    if (file.format === 'png') {
        const signature = [137, 80, 78, 71, 13, 10, 26, 10];
        if (bytes.length < 24 || !signature.every((value, index) => bytes[index] === value) || !asciiAt(bytes, 12, 'IHDR')) {
            return fail('PNG signature or IHDR is invalid');
        }
        return { valid: true, width: view.getUint32(16, false), height: view.getUint32(20, false), icoSizes: [], error: '' };
    }

    if (file.format === 'ico') {
        if (bytes.length < 6 || view.getUint16(0, true) !== 0 || view.getUint16(2, true) !== 1) {
            return fail('ICO header is invalid');
        }
        const count = view.getUint16(4, true);
        if (count < 1 || 6 + count * 16 > bytes.length) return fail('ICO directory is truncated');
        const icoSizes = [];
        for (let index = 0; index < count; index++) {
            const offset = 6 + index * 16;
            const width = bytes[offset] || 256;
            const height = bytes[offset + 1] || 256;
            const payloadSize = view.getUint32(offset + 8, true);
            const payloadOffset = view.getUint32(offset + 12, true);
            if (width !== height || payloadSize < 1 || payloadOffset + payloadSize > bytes.length) {
                return fail(`ICO entry ${index + 1} is invalid or out of bounds`);
            }
            icoSizes.push(width);
        }
        return { valid: true, width: null, height: null, icoSizes, error: '' };
    }

    if (file.format === 'svg') {
        const text = new TextDecoder().decode(bytes).trim();
        return /^<svg[\s>]/i.test(text)
            ? { valid: true, width: null, height: null, icoSizes: [], error: '' }
            : fail('SVG root element is missing');
    }

    if (file.format === 'jpg') {
        if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8 || bytes[bytes.length - 2] !== 0xFF || bytes[bytes.length - 1] !== 0xD9) {
            return fail('JPEG start/end markers are invalid');
        }
        let offset = 2;
        while (offset + 8 < bytes.length) {
            if (bytes[offset] !== 0xFF) {
                offset++;
                continue;
            }
            const marker = bytes[offset + 1];
            if (marker === 0xD8 || marker === 0xD9) {
                offset += 2;
                continue;
            }
            if (offset + 4 > bytes.length) break;
            const length = view.getUint16(offset + 2, false);
            if (length < 2 || offset + 2 + length > bytes.length) return fail('JPEG segment is truncated');
            if ([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF].includes(marker)) {
                return {
                    valid: true,
                    width: view.getUint16(offset + 7, false),
                    height: view.getUint16(offset + 5, false),
                    icoSizes: [],
                    error: ''
                };
            }
            offset += 2 + length;
        }
        return fail('JPEG dimensions are missing');
    }

    if (file.format === 'webp') {
        if (bytes.length < 30 || !asciiAt(bytes, 0, 'RIFF') || !asciiAt(bytes, 8, 'WEBP')) return fail('WebP RIFF header is invalid');
        if (asciiAt(bytes, 12, 'VP8X')) {
            const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
            const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
            return { valid: true, width, height, icoSizes: [], error: '' };
        }
        if (asciiAt(bytes, 12, 'VP8L') && bytes[20] === 0x2F) {
            const width = 1 + bytes[21] + ((bytes[22] & 0x3F) << 8);
            const height = 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0F) << 10);
            return { valid: true, width, height, icoSizes: [], error: '' };
        }
        if (asciiAt(bytes, 12, 'VP8 ') && bytes.length >= 30 && bytes[23] === 0x9D && bytes[24] === 0x01 && bytes[25] === 0x2A) {
            return {
                valid: true,
                width: view.getUint16(26, true) & 0x3FFF,
                height: view.getUint16(28, true) & 0x3FFF,
                icoSizes: [],
                error: ''
            };
        }
        return fail('WebP dimensions are missing');
    }

    if (file.format === 'avif') {
        if (bytes.length < 24 || !asciiAt(bytes, 4, 'ftyp')) return fail('AVIF file-type box is invalid');
        const ispe = findAscii(bytes, 'ispe');
        if (ispe < 0 || ispe + 16 > bytes.length) return fail('AVIF image spatial extents are missing');
        return {
            valid: true,
            width: view.getUint32(ispe + 8, false),
            height: view.getUint32(ispe + 12, false),
            icoSizes: [],
            error: ''
        };
    }

    return { valid: true, width: null, height: null, icoSizes: [], error: '' };
}

async function inspectGeneratedArtifact(file) {
    const bytes = new Uint8Array(await file.blob.arrayBuffer());
    const result = inspectArtifactBytes(file, bytes);
    const expectedMime = artifactMimeType(file.format);
    if (result.valid && expectedMime && file.blob.type !== expectedMime) {
        return { ...result, valid: false, error: `MIME type is ${file.blob.type || 'empty'}, expected ${expectedMime}` };
    }
    return result;
}

async function decodeImagePixels(file) {
    if (typeof createImageBitmap !== 'function') return null;
    const bitmap = await createImageBitmap(file.blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    bitmap.close?.();
    canvas.width = 0;
    canvas.height = 0;
    return pixels;
}

async function validateGeneratedArtifacts(checks) {
    const errors = [];
    const warnings = [];
    for (const file of generatedFiles) {
        let result;
        try {
            result = await inspectGeneratedArtifact(file);
        } catch (error) {
            errors.push(`${file.name}: ${error.message}`);
            continue;
        }
        if (!result.valid) {
            errors.push(`${file.name}: ${result.error}`);
            continue;
        }
        if (typeof file.size?.width === 'number' && typeof file.size?.height === 'number' &&
            (result.width !== file.size.width || result.height !== file.size.height)) {
            errors.push(`${file.name}: decoded ${result.width || '?'}x${result.height || '?'}, declared ${file.size.width}x${file.size.height}`);
        }
        if (file.format === 'ico' && Array.isArray(file.icoSizes)) {
            const expectedSizes = file.icoSizes.map(size => typeof size === 'number' ? size : size.width);
            const missing = expectedSizes.filter(size => !result.icoSizes.includes(size));
            if (missing.length) errors.push(`${file.name}: missing ICO entries ${missing.join(', ')}`);
        }
        if (file.purpose === 'monochrome') {
            const pixels = await decodeImagePixels(file);
            if (!pixels) {
                warnings.push(`${file.name}: monochrome pixels could not be inspected in this browser`);
            } else {
                let colored = false;
                for (let offset = 0; offset < pixels.data.length; offset += 4) {
                    if (pixels.data[offset + 3] > 0 && (pixels.data[offset] > 1 || pixels.data[offset + 1] > 1 || pixels.data[offset + 2] > 1)) {
                        colored = true;
                        break;
                    }
                }
                if (colored) errors.push(`${file.name}: monochrome asset contains non-black RGB pixels`);
            }
        }
    }
    if (errors.length) {
        addValidationCheck(checks, 'fail', 'Artifact byte contracts', fileSpecSummary(errors));
    } else if (warnings.length) {
        addValidationCheck(checks, 'warn', 'Artifact byte contracts', fileSpecSummary(warnings));
    } else if (generatedFiles.length) {
        addValidationCheck(checks, 'pass', 'Artifact byte contracts', `${generatedFiles.length} image artifact${generatedFiles.length === 1 ? '' : 's'} decoded with matching signatures, MIME types, dimensions, and purpose rules.`);
    }
}

function checkFileSet(checks, label, specs) {
    const missing = [];
    const wrong = [];

    for (const spec of specs) {
        const file = getFileByName(spec.name);
        if (!file) {
            missing.push(spec.name);
            continue;
        }
        if (typeof spec.width === 'number' && typeof spec.height === 'number') {
            const actualWidth = file.size?.width;
            const actualHeight = file.size?.height;
            if (actualWidth !== spec.width || actualHeight !== spec.height) {
                wrong.push(`${spec.name} is ${actualWidth || '?'}x${actualHeight || '?'}, expected ${spec.width}x${spec.height}`);
            }
        }
    }

    if (missing.length || wrong.length) {
        const details = [];
        if (missing.length) details.push(`Missing: ${fileSpecSummary(missing)}`);
        if (wrong.length) details.push(`Wrong dimensions: ${fileSpecSummary(wrong)}`);
        addValidationCheck(checks, 'fail', label, details.join(' | '));
    } else {
        const dimensions = label === 'PWA splash files'
            ? ` Dimensions: ${specs.map(spec => `${spec.width}x${spec.height}`).join(', ')}.`
            : '';
        addValidationCheck(checks, 'pass', label, `${specs.length} expected file${specs.length === 1 ? '' : 's'} present with expected dimensions.${dimensions}`);
    }
}

function expectedPresetFileGroups() {
    if (activePresetKey === 'web') {
        return [
            {
                label: 'Modern web files',
                specs: [
                    { name: 'favicon.ico' },
                    { name: 'icon.svg' },
                    { name: 'apple-touch-icon.png', width: 180, height: 180 },
                    { name: 'icon-192.png', width: 192, height: 192 },
                    { name: 'icon-512.png', width: 512, height: 512 }
                ]
            }
        ];
    }
    if (activePresetKey === 'pwa') {
        const iconSpecs = PWA_ICON_SIZES.flatMap(px => [
            { name: `pwa/icons/icon-${px}x${px}.png`, width: px, height: px },
            { name: `pwa/icons/icon-maskable-${px}x${px}.png`, width: px, height: px }
        ]);
        if (manifestMonochromeEnabled()) {
            iconSpecs.push({ name: 'pwa/icons/icon-monochrome-512x512.png', width: 512, height: 512 });
        }
        return [
            {
                label: 'PWA icon files',
                specs: iconSpecs
            },
            { label: 'PWA splash files', specs: pwaSplashFileSpecs() }
        ];
    }
    if (activePresetKey === 'extension') {
        return [
            {
                label: 'Extension icon files',
                specs: [16, 32, 48, 128].map(px => ({ name: `extension/icons/icon${px}.png`, width: px, height: px }))
            }
        ];
    }
    if (activePresetKey === 'android') {
        return [
            {
                label: 'Android adaptive icon files',
                specs: ANDROID_DENSITY_SPECS.flatMap(spec => [
                    { name: `android/mipmap-${spec.density}/ic_launcher_foreground.png`, width: spec.adaptive, height: spec.adaptive },
                    { name: `android/mipmap-${spec.density}/ic_launcher_background.png`, width: spec.adaptive, height: spec.adaptive },
                    { name: `android/mipmap-${spec.density}/ic_launcher.png`, width: spec.legacy, height: spec.legacy }
                ])
            }
        ];
    }
    if (activePresetKey === 'ios') {
        return [
            {
                label: 'iOS AppIcon files',
                specs: IOS_ICON_SPECS.map(([, pointSize, scale, pixels]) => ({
                    name: `ios/AppIcon.appiconset/${iosIconFileName(pointSize, scale)}`,
                    width: pixels,
                    height: pixels
                }))
            }
        ];
    }
    if (activePresetKey === 'windows') {
        return [
            {
                label: 'Windows tile files',
                specs: [
                    { name: 'windows/favicon.ico' },
                    ...WINDOWS_TILE_SPECS.map(tile => ({
                        name: `windows/mstile-${tile.width}x${tile.height}.png`,
                        width: tile.width,
                        height: tile.height
                    }))
                ]
            }
        ];
    }
    if (activePresetKey === 'social') {
        return [
            {
                label: 'Social preview files',
                specs: [
                    { name: 'social/og-image.png', width: 1200, height: 630 },
                    { name: 'social/twitter-card.png', width: 1200, height: 675 },
                    { name: 'social/linkedin-preview.png', width: 1200, height: 627 }
                ]
            }
        ];
    }
    return [];
}

async function validateSupportFiles(checks) {
    const expected = ['README.txt'];
    if (generatedSnippets.html) expected.push('snippets/head.html');
    if (generatedSnippets.manifest) expected.push(activePresetKey === 'pwa' ? 'pwa/manifest.webmanifest' : 'manifest.webmanifest');
    if (generatedSnippets.social) expected.push('snippets/social-meta.html');
    if (generatedSnippets.extension) expected.push('extension/manifest-icons.json');
    if (generatedSnippets.android) expected.push('android/mipmap-anydpi-v26/ic_launcher.xml');
    if (generatedSnippets.ios) expected.push('ios/AppIcon.appiconset/Contents.json');
    if (generatedSnippets.windows) expected.push('windows/browserconfig.xml');

    const supportNames = new Set(getSupportFiles().map(file => file.name));
    const missing = expected.filter(name => !supportNames.has(name));
    const malformed = [];
    for (const file of getSupportFiles()) {
        const text = (await file.blob.text()).trim();
        if (!text) {
            malformed.push(`${file.name} is empty`);
            continue;
        }
        if (file.name.endsWith('.json')) {
            try {
                JSON.parse(text);
            } catch {
                malformed.push(`${file.name} is invalid JSON`);
            }
        } else if (file.name.endsWith('.xml') && !text.startsWith('<')) {
            malformed.push(`${file.name} is invalid XML`);
        } else if (file.name.endsWith('.html') && !text.includes('<')) {
            malformed.push(`${file.name} is invalid HTML`);
        }
    }

    if (missing.length || malformed.length) {
        const details = [];
        if (missing.length) details.push(`Missing: ${fileSpecSummary(missing)}`);
        if (malformed.length) details.push(`Malformed: ${fileSpecSummary(malformed)}`);
        addValidationCheck(checks, 'fail', 'Deployable support files', details.join(' | '));
    } else {
        addValidationCheck(checks, 'pass', 'Deployable support files', `${expected.length} support file${expected.length === 1 ? '' : 's'} will be included in ZIP/folder export.`);
    }
}

function validateManifestIcons(checks) {
    if (activePresetKey !== 'web' && activePresetKey !== 'pwa') return;
    const relevantIcons = manifestIconFiles();
    const colorIcons = relevantIcons.filter(file => file.purpose !== 'monochrome');

    if (relevantIcons.length === 0) {
        addValidationCheck(checks, 'warn', 'Manifest icon metadata', 'No manifest-sized PNG icons were generated for this export.');
        return;
    }
    if (!generatedSnippets.manifest) {
        addValidationCheck(checks, 'fail', 'Manifest icon metadata', 'Generated icons need a manifest snippet but none was produced.');
        return;
    }

    try {
        const manifest = JSON.parse(generatedSnippets.manifest);
        const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
        const mismatches = [];
        for (const file of colorIcons) {
            const expected = manifestIconEntry(file);
            const entry = icons.find(icon => icon.src === expected.src && icon.purpose === expected.purpose);
            if (!entry) {
                mismatches.push(`${file.name} ${expected.purpose} missing`);
                continue;
            }
            if (entry.sizes !== expected.sizes || entry.type !== expected.type) {
                mismatches.push(`${file.name} ${expected.purpose} metadata mismatch`);
            }
        }
        if (manifestMonochromeEnabled()) {
            const monochromeFile = monochromeManifestIconFile(relevantIcons);
            if (!monochromeFile) {
                mismatches.push('monochrome icon missing source file');
            } else {
                const expected = manifestIconEntry(monochromeFile, 'monochrome');
                const entry = icons.find(icon => icon.src === expected.src && icon.purpose === 'monochrome');
                if (!entry) {
                    mismatches.push(`${monochromeFile.name} monochrome missing`);
                } else if (entry.sizes !== expected.sizes || entry.type !== expected.type) {
                    mismatches.push(`${monochromeFile.name} monochrome metadata mismatch`);
                }
            }
        }
        if (mismatches.length) {
            addValidationCheck(checks, 'fail', 'Manifest icon metadata', fileSpecSummary(mismatches));
        } else {
            const iconCount = colorIcons.length + (manifestMonochromeEnabled() && monochromeManifestIconFile(relevantIcons) ? 1 : 0);
            addValidationCheck(checks, 'pass', 'Manifest icon metadata', `${iconCount} generated icon${iconCount === 1 ? '' : 's'} match manifest src, sizes, type, and purpose.`);
        }
    } catch (error) {
        addValidationCheck(checks, 'fail', 'Manifest icon metadata', `Manifest JSON is invalid: ${error.message}`);
    }
}

function hexRgb(value) {
    const color = normalizeSvgColor(value, '#09090b');
    return [
        parseInt(color.slice(1, 3), 16),
        parseInt(color.slice(3, 5), 16),
        parseInt(color.slice(5, 7), 16)
    ];
}

async function validateMaskableSafeZone(checks, inspectPixels = true) {
    const maskableFiles = generatedFiles.filter(file => file.purpose === 'maskable' || file.name.includes('maskable'));
    if (activePresetKey !== 'pwa' && maskableFiles.length === 0) return;
    if (maskableFiles.length === 0) {
        addValidationCheck(checks, 'fail', 'Maskable safe zone', 'No maskable PWA icons were generated.');
        return;
    }
    const metadataFailures = maskableFiles.filter(file =>
        file.safeZoneRadiusRatio !== 0.4 ||
        typeof file.safeZonePaddingPercent !== 'number' ||
        file.safeZonePaddingPercent < 22
    );
    if (metadataFailures.length) {
        addValidationCheck(checks, 'fail', 'Maskable safe zone', `Missing 40% safe-zone contract: ${fileSpecSummary(metadataFailures.map(file => file.name))}`);
        return;
    }
    if (!inspectPixels) {
        addValidationCheck(checks, 'pass', 'Maskable safe zone', `${maskableFiles.length} maskable icon${maskableFiles.length === 1 ? '' : 's'} use an inscribed-square 40% safe-zone contract.`);
        return;
    }

    const pixelFailures = [];
    const pixelWarnings = [];
    for (const file of maskableFiles) {
        const pixels = await decodeImagePixels(file);
        if (!pixels) {
            pixelWarnings.push(`${file.name}: pixel inspection unavailable`);
            continue;
        }
        const expected = hexRgb(file.safeZoneBackgroundColor);
        const radius = Math.min(pixels.width, pixels.height) * file.safeZoneRadiusRatio;
        const centerX = (pixels.width - 1) / 2;
        const centerY = (pixels.height - 1) / 2;
        let mismatch = false;
        for (let y = 0; y < pixels.height && !mismatch; y++) {
            for (let x = 0; x < pixels.width; x++) {
                if (Math.hypot(x - centerX, y - centerY) <= radius) continue;
                const offset = (y * pixels.width + x) * 4;
                if (pixels.data[offset + 3] !== 255 ||
                    Math.abs(pixels.data[offset] - expected[0]) > 3 ||
                    Math.abs(pixels.data[offset + 1] - expected[1]) > 3 ||
                    Math.abs(pixels.data[offset + 2] - expected[2]) > 3) {
                    mismatch = true;
                    break;
                }
            }
        }
        if (mismatch) pixelFailures.push(`${file.name}: foreground or transparency extends outside the 40% safe zone`);
    }
    if (pixelFailures.length) {
        addValidationCheck(checks, 'fail', 'Maskable safe zone', fileSpecSummary(pixelFailures));
    } else if (pixelWarnings.length) {
        addValidationCheck(checks, 'warn', 'Maskable safe zone', fileSpecSummary(pixelWarnings));
    } else {
        addValidationCheck(checks, 'pass', 'Maskable safe zone', `${maskableFiles.length} decoded maskable icon${maskableFiles.length === 1 ? '' : 's'} keep foreground pixels inside the 40% radius and an opaque background outside it.`);
    }
}

function validateSizeBudget(checks) {
    const budgetBytes = getSizeBudgetBytes();
    if (!budgetBytes) return;
    const totalBytes = generatedFiles.reduce((sum, file) => sum + (file.blob?.size || 0), 0);
    if (totalBytes > budgetBytes) {
        addValidationCheck(checks, 'warn', 'Size budget', `${formatFileSize(totalBytes)} total exceeds ${formatFileSize(budgetBytes)} budget by ${formatFileSize(totalBytes - budgetBytes)}.`);
    } else {
        addValidationCheck(checks, 'pass', 'Size budget', `${formatFileSize(totalBytes)} total is within the ${formatFileSize(budgetBytes)} budget.`);
    }
}

async function validateGeneratedExport(options = {}) {
    const checks = [];
    if (generatedFiles.length === 0) {
        addValidationCheck(checks, 'fail', 'Generated files', 'No generated files are available to validate.');
    } else {
        addValidationCheck(checks, 'pass', 'Generated files', `${generatedFiles.length} image file${generatedFiles.length === 1 ? '' : 's'} generated.`);
    }

    if (options.artifactChecks !== false) await validateGeneratedArtifacts(checks);

    const groups = expectedPresetFileGroups();
    for (const group of groups) checkFileSet(checks, group.label, group.specs);
    if (groups.length === 0 && activePresetKey) {
        addValidationCheck(checks, 'warn', 'Platform file rules', `No strict validator is defined for preset "${activePresetKey}".`);
    } else if (groups.length === 0) {
        addValidationCheck(checks, 'warn', 'Platform file rules', 'Custom exports validate generated files and support files only.');
    }

    validateManifestIcons(checks);
    await validateMaskableSafeZone(checks, options.artifactChecks !== false);
    await validateSupportFiles(checks);
    validateSizeBudget(checks);

    const status = checks.some(check => check.status === 'fail') ? 'fail' : checks.some(check => check.status === 'warn') ? 'warn' : 'pass';
    return {
        status,
        title: status === 'pass' ? uiText('validation.titles.pass') : status === 'warn' ? uiText('validation.titles.warn') : uiText('validation.titles.fail'),
        detail: status === 'pass'
            ? uiText('validation.details.pass')
            : uiText('validation.details.review'),
        checks
    };
}

async function renderExportValidation(options = {}) {
    const section = document.getElementById('validationSection');
    const summary = document.getElementById('validationSummary');
    const list = document.getElementById('validationList');
    const result = await validateGeneratedExport(options);

    setElementVisible(section, true, 'block');
    summary.className = `validation-summary ${result.status}`;
    summary.textContent = '';
    const title = document.createElement('strong');
    title.textContent = result.title;
    const detail = document.createElement('span');
    detail.textContent = result.detail;
    summary.appendChild(title);
    summary.appendChild(detail);

    list.textContent = '';
    for (const check of result.checks) {
        const item = document.createElement('li');
        item.className = 'validation-item';
        const dot = document.createElement('span');
        dot.className = `validation-state ${check.status}`;
        const body = document.createElement('span');
        const label = document.createElement('strong');
        label.textContent = check.label;
        body.appendChild(label);
        body.appendChild(document.createTextNode(check.detail));
        item.appendChild(dot);
        item.appendChild(body);
        list.appendChild(item);
    }
    return result;
}

function matchesReplacementTarget(file) {
    if (replacementTargetNames.size === 0) return true;
    const normalized = normalizeTemplateName(file.name);
    const short = normalizeTemplateName(baseName(file.name));
    return replacementTargetNames.has(normalized) || replacementTargetNames.has(short);
}

function getExportFiles() {
    let imageFiles = generatedFiles;
    if (replacementTargetNames.size > 0) {
        const matched = generatedFiles.filter(matchesReplacementTarget);
        if (matched.length > 0) imageFiles = matched;
    }
    return [...imageFiles, ...getSupportFiles()];
}

async function downloadAll() {
    if (generatedFiles.length === 0) return;

    btnDownloadAll.disabled = true;
    btnDownloadAll.innerHTML = '<span class="spinner"></span> Creating ZIP...';

    try {
        const zipFiles = [];
        const exportFiles = await getExportFilesWithManifest();
        for (const file of exportFiles) {
            const buf = await file.blob.arrayBuffer();
            zipFiles.push({ name: file.name, data: new Uint8Array(buf) });
        }

        const zipBlob = buildZip(zipFiles);
        const url = URL.createObjectURL(zipBlob);

        const link = document.createElement('a');
        link.href = url;
        link.download = `${sourceFileName}-icons.zip`;
        link.click();

        URL.revokeObjectURL(url);
        clearDraftAfterExportIfRequested();
    } catch (error) {
        showStatus(`Error creating ZIP: ${error.message}`, 'error');
    }

    btnDownloadAll.disabled = false;
    btnDownloadAll.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Download All as ZIP
    `;
}

async function saveToFolder() {
    if (generatedFiles.length === 0) return;
    let operation = null;
    try {
        const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        const exportFiles = await getExportFilesWithManifest();
        operation = beginOperation('folder export', exportFiles.length);
        btnGenerate.disabled = true;
        btnDownloadAll.disabled = true;
        btnSaveToFolder.disabled = true;
        const result = await saveExportBundleToDirectory(
            dirHandle,
            exportFiles,
            `IconForge-${cleanPathSegment(sourceFileName)}-icons`,
            operation
        );
        const conflictNote = result.conflicts.length
            ? ` (${result.conflicts.length} existing destination${result.conflicts.length === 1 ? '' : 's'} skipped)`
            : '';
        showStatus(`Saved ${result.written.length} files to new folder "${result.directoryName}"${conflictNote}.`, 'success');
        clearDraftAfterExportIfRequested();
    } catch (err) {
        if (err.name !== 'AbortError') {
            showStatus(`Error saving: ${err.message}`, 'error');
        } else if (operation) {
            showStatus(err.message, 'warning');
        }
    } finally {
        if (operation) finishOperation(operation);
        btnGenerate.disabled = false;
        btnDownloadAll.disabled = false;
        btnSaveToFolder.disabled = false;
    }
}

async function directoryEntryExists(rootHandle, name) {
    try {
        await rootHandle.getDirectoryHandle(name);
        return true;
    } catch (error) {
        if (!['NotFoundError', 'TypeMismatchError'].includes(error.name)) throw error;
    }
    try {
        await rootHandle.getFileHandle(name);
        return true;
    } catch (error) {
        if (!['NotFoundError', 'TypeMismatchError'].includes(error.name)) throw error;
    }
    return false;
}

async function chooseUniqueBundleDirectory(rootHandle, requestedName) {
    const base = cleanPathSegment(requestedName);
    const conflicts = [];
    for (let suffix = 1; suffix <= 1000; suffix++) {
        const candidate = suffix === 1 ? base : `${base}-${suffix}`;
        if (!await directoryEntryExists(rootHandle, candidate)) {
            return { directoryName: candidate, conflicts };
        }
        conflicts.push(candidate);
    }
    throw new Error(`Could not find an unused export folder after checking 1000 names based on "${base}".`);
}

async function saveExportBundleToDirectory(rootHandle, exportFiles, requestedName, operation = null) {
    const { directoryName, conflicts } = await chooseUniqueBundleDirectory(rootHandle, requestedName);
    throwIfOperationCancelled(operation?.controller.signal);
    const bundleHandle = await rootHandle.getDirectoryHandle(directoryName, { create: true });
    const written = [];
    try {
        for (const file of exportFiles) {
            if (operation) {
                await runOperationStep(operation, 'Writing folder', file.name, () =>
                    writeFileToDirectory(bundleHandle, file.name, file.blob, operation.controller.signal)
                );
            } else {
                await writeFileToDirectory(bundleHandle, file.name, file.blob);
            }
            written.push(file.name);
        }
        return { directoryName, conflicts, written, rolledBack: false };
    } catch (error) {
        let rollbackError = null;
        try {
            await rootHandle.removeEntry(directoryName, { recursive: true });
        } catch (removeError) {
            rollbackError = removeError;
        }
        const cancelled = error.name === 'AbortError';
        if (!rollbackError) {
            const result = new OperationCancelledError(
                `${cancelled ? 'Folder export cancelled' : 'Folder export failed'}; incomplete folder "${directoryName}" was removed. It is safe to retry.`
            );
            if (!cancelled) result.name = 'Error';
            result.exportResult = { directoryName, conflicts, written, rolledBack: true };
            throw result;
        }
        const partialFiles = written.length ? written.join(', ') : 'none';
        const result = new OperationCancelledError(
            `${cancelled ? 'Folder export cancelled' : 'Folder export failed'} and "${directoryName}" could not be removed. Files written: ${partialFiles}. Remove that folder before retrying. Rollback error: ${rollbackError.message}`
        );
        if (!cancelled) result.name = 'Error';
        result.exportResult = { directoryName, conflicts, written, rolledBack: false };
        throw result;
    }
}

async function writeFileToDirectory(rootHandle, path, blob, signal = null) {
    const parts = path.split('/').filter(Boolean);
    if (!parts.length || parts.some(part => part === '.' || part === '..')) {
        throw new Error(`Unsafe export path: ${path}`);
    }
    throwIfOperationCancelled(signal);
    let dir = rootHandle;
    for (const part of parts.slice(0, -1)) {
        throwIfOperationCancelled(signal);
        dir = await dir.getDirectoryHandle(part, { create: true });
    }
    const fileHandle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
    const writable = await fileHandle.createWritable();
    const abortWritable = async () => {
        try {
            await writable.abort?.();
        } catch {
            // The write may already be closed.
        }
    };
    const handleAbort = () => {
        void abortWritable();
    };
    signal?.addEventListener('abort', handleAbort, { once: true });
    try {
        throwIfOperationCancelled(signal);
        await writable.write(blob);
        throwIfOperationCancelled(signal);
        await writable.close();
    } catch (error) {
        await abortWritable();
        throw error;
    } finally {
        signal?.removeEventListener('abort', handleAbort);
    }
}

// ICO Generation
async function generateICO(img, sizes, crop = null) {
    const images = [];
    
    for (const size of sizes) {
        const canvas = document.createElement('canvas');
        canvas.width = size.width;
        canvas.height = size.height;
        const ctx = canvas.getContext('2d');
        drawIconToContext(ctx, img, size.width, size.height, crop, getProcessingOptions());
        
        try {
            const blob = await canvasToOutputBlob(canvas, 'image/png', undefined, `ICO PNG ${size.width}x${size.height}`);
            const arrayBuffer = await blob.arrayBuffer();
            images.push({
                width: size.width,
                height: size.height,
                data: new Uint8Array(arrayBuffer)
            });
        } finally {
            canvas.width = 0;
            canvas.height = 0;
        }
    }
    
    return createICO(images);
}

function createICO(images) {
    // ICO file format:
    // ICONDIR (6 bytes) + ICONDIRENTRY array (16 bytes each) + image data
    
    const headerSize = 6;
    const entrySize = 16;
    const entriesSize = images.length * entrySize;
    
    // Calculate total size and offsets
    let dataOffset = headerSize + entriesSize;
    const entries = images.map(img => {
        const entry = {
            width: img.width >= 256 ? 0 : img.width,
            height: img.height >= 256 ? 0 : img.height,
            dataSize: img.data.length,
            dataOffset: dataOffset
        };
        dataOffset += img.data.length;
        return entry;
    });
    
    const totalSize = dataOffset;
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    
    // ICONDIR header
    view.setUint16(0, 0, true);           // Reserved
    view.setUint16(2, 1, true);           // Type (1 = ICO)
    view.setUint16(4, images.length, true); // Number of images
    
    // ICONDIRENTRY array
    let offset = headerSize;
    for (let i = 0; i < images.length; i++) {
        const entry = entries[i];
        view.setUint8(offset, entry.width);      // Width
        view.setUint8(offset + 1, entry.height); // Height
        view.setUint8(offset + 2, 0);            // Color palette
        view.setUint8(offset + 3, 0);            // Reserved
        view.setUint16(offset + 4, 1, true);     // Color planes
        view.setUint16(offset + 6, 32, true);    // Bits per pixel
        view.setUint32(offset + 8, entry.dataSize, true);   // Image data size
        view.setUint32(offset + 12, entry.dataOffset, true); // Image data offset
        offset += entrySize;
    }
    
    // Image data (PNG format)
    const uint8View = new Uint8Array(buffer);
    for (let i = 0; i < images.length; i++) {
        uint8View.set(images[i].data, entries[i].dataOffset);
    }
    
    return new Blob([buffer], { type: 'image/x-icon' });
}

function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

function showStatus(message, type) {
    if (!message) {
        status.className = 'status';
        status.textContent = '';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        return;
    }
    status.className = `status visible ${type}`;
    status.textContent = message;
    const isError = type === 'error';
    status.setAttribute('role', isError ? 'alert' : 'status');
    status.setAttribute('aria-live', isError ? 'assertive' : 'polite');
    if (isError) status.focus();
}

const updateNotice = document.getElementById('updateNotice');
const updateNoticeText = document.getElementById('updateNoticeText');
const btnReloadUpdate = document.getElementById('btnReloadUpdate');
const btnDismissUpdate = document.getElementById('btnDismissUpdate');
let pendingServiceWorker = null;
let reloadOnControllerChange = false;

function showUpdateNotice(message, worker = null) {
    if (worker) pendingServiceWorker = worker;
    updateNoticeText.textContent = message;
    updateNotice.hidden = false;
}

function hideUpdateNotice() {
    updateNotice.hidden = true;
}

btnReloadUpdate.addEventListener('click', () => {
    saveDraftState({ silent: true });
    if (pendingServiceWorker) {
        reloadOnControllerChange = true;
        pendingServiceWorker.postMessage({ type: 'SKIP_WAITING' });
        return;
    }
    window.location.reload();
});

btnDismissUpdate.addEventListener('click', hideUpdateNotice);

function watchServiceWorker(registration, hadController) {
    if (registration.waiting && hadController) {
        showUpdateNotice('A new offline shell is ready. Reload to use it.', registration.waiting);
    }

    registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                showUpdateNotice('A new offline shell is ready. Reload to use it.', worker);
            } else if (worker.state === 'activated' && hadController && !reloadOnControllerChange) {
                showUpdateNotice('Icon Forge was updated in the background. Reload to refresh this tab.');
            }
        });
    });

    registration.update?.();
}

if (typeof window !== 'undefined' && window.__ICONFORGE_ENABLE_TEST_API__) {
    window.__ICONFORGE_TEST__ = {
        buildZip,
        crc32,
        APP_VERSION,
        PLATFORM_MATRIX_METADATA,
        UI_STRINGS,
        uiText,
        getUiString,
        createICO,
        cleanPathSegment,
        baseName,
        normalizeTemplateName,
        inspectAssetBase,
        normalizeAssetBase,
        deploymentUrlFor,
        validateDeploymentUrlOptions,
        PWA_SPLASH_SPECS,
        startupImageMediaFor,
        inspectArtifactBytes,
        inspectGeneratedArtifact,
        getOutputFileName,
        iosIconFileName,
        getManifestMetadata,
        validateManifestMetadata,
        buildManifestSnippet,
        buildExtensionSnippet,
        buildAndroidSnippet,
        buildIosContents,
        buildWindowsBrowserConfig,
        generateSvgFavicon,
        buildSocialSnippet,
        buildFrameworkHandoffSnippets,
        generateSnippets,
        getSupportFiles,
        buildExportManifest,
        getExportFilesWithManifest,
        buildGenerationDiagnostics,
        buildDiagnosticsSupportReport,
        diagnosticsSupportJson,
        DRAFT_SCHEMA,
        DRAFT_STORAGE_KEY,
        LEGACY_DRAFT_STORAGE_KEYS,
        DRAFT_TTL_MS,
        MAX_DRAFT_BYTES,
        buildDraftSnapshot,
        inspectDraftRecord,
        migrateDraftSnapshot,
        draftStorageSummary,
        readDraftSnapshot,
        saveDraftState,
        clearDraftState,
        clearDraftAfterExportIfRequested,
        applyDraftControls,
        setStoredDraftForTest(raw, key = DRAFT_STORAGE_KEY) {
            const storage = draftStorage();
            if (raw === null) storage?.removeItem(key);
            else storage?.setItem(key, raw);
        },
        getStoredDraftForTest(key = DRAFT_STORAGE_KEY) {
            return draftStorage()?.getItem(key) || null;
        },
        handleLaunchFiles,
        getFeatureDiagnostics,
        getSkippedFormatDiagnostics,
        validateGeneratedExport,
        renderExportValidation,
        renderGenerationDiagnostics,
        matchesReplacementTarget,
        getExportFiles,
        addGeneratedFile,
        assertValidOutputBlob,
        canvasToBlobWithTimeout,
        canvasToOutputBlob,
        initWorker,
        resizeInWorker,
        disposeResizeWorker,
        directoryEntryExists,
        chooseUniqueBundleDirectory,
        saveExportBundleToDirectory,
        writeFileToDirectory,
        REPLACEMENT_ZIP_LIMITS,
        readZipFileNames,
        getWorkerDebugState() {
            return {
                active: Boolean(resizeWorker),
                pendingJobs: workerCallbacks.size,
                worker: resizeWorker
            };
        },
        validateSvgSourceText,
        setState(next = {}) {
            if (Object.prototype.hasOwnProperty.call(next, 'sourceFileName')) sourceFileName = next.sourceFileName;
            if (Object.prototype.hasOwnProperty.call(next, 'sourceMode')) sourceMode = next.sourceMode;
            if (Object.prototype.hasOwnProperty.call(next, 'originalImageData')) originalImageData = next.originalImageData;
            if (Object.prototype.hasOwnProperty.call(next, 'sourceImageSize')) {
                const size = next.sourceImageSize;
                sourceImage = size ? { naturalWidth: size.width, naturalHeight: size.height } : null;
            }
            if (Object.prototype.hasOwnProperty.call(next, 'cropRegion')) cropRegion = next.cropRegion;
            if (Object.prototype.hasOwnProperty.call(next, 'draftEnabled')) {
                draftEnabledToggle.checked = Boolean(next.draftEnabled);
                if (draftEnabledToggle.checked) draftClearedUntilChange = false;
                applyDraftPreferenceControls({
                    enabled: draftEnabledToggle.checked,
                    clearOnExport: Boolean(draftClearOnExportToggle.checked)
                });
            }
            if (Object.prototype.hasOwnProperty.call(next, 'draftSourceEnabled')) draftSourceToggle.checked = Boolean(next.draftSourceEnabled);
            if (Object.prototype.hasOwnProperty.call(next, 'draftClearOnExport')) draftClearOnExportToggle.checked = Boolean(next.draftClearOnExport);
            if (Object.prototype.hasOwnProperty.call(next, 'generatedFiles')) generatedFiles = next.generatedFiles;
            if (Object.prototype.hasOwnProperty.call(next, 'activePresetKey')) activePresetKey = next.activePresetKey;
            if (Object.prototype.hasOwnProperty.call(next, 'featureSupport')) Object.assign(featureSupport, next.featureSupport);
            if (Object.prototype.hasOwnProperty.call(next, 'generationStats')) {
                const nextStats = next.generationStats || {};
                generationStats = {
                    ...createGenerationStats(),
                    ...nextStats,
                    fallbackReasons: Array.from(nextStats.fallbackReasons || [])
                };
            }
            if (Object.prototype.hasOwnProperty.call(next, 'replacementTargetNames')) {
                replacementTargetNames = new Set(next.replacementTargetNames.map(normalizeTemplateName));
            }
            if (Object.prototype.hasOwnProperty.call(next, 'generatedSnippets')) generatedSnippets = next.generatedSnippets;
            if (Object.prototype.hasOwnProperty.call(next, 'backgroundColor')) backgroundColor.value = next.backgroundColor;
            if (Object.prototype.hasOwnProperty.call(next, 'lossyQualityPercent')) {
                lossyQualitySlider.value = String(clampNumber(next.lossyQualityPercent, 40, 100, 92));
                updateProcessingControlLabels();
            }
            if (Object.prototype.hasOwnProperty.call(next, 'sizeBudgetKb')) sizeBudgetInput.value = String(next.sizeBudgetKb ?? '');
            if (Object.prototype.hasOwnProperty.call(next, 'deploymentUrlMode')) assetUrlMode.value = next.deploymentUrlMode;
            if (Object.prototype.hasOwnProperty.call(next, 'deploymentAssetBase')) assetUrlBase.value = next.deploymentAssetBase;
            if (Object.prototype.hasOwnProperty.call(next, 'cacheBust')) cacheBustToggle.checked = Boolean(next.cacheBust);
            if (Object.prototype.hasOwnProperty.call(next, 'manifestMetadata')) {
                const fieldMap = {
                    name: manifestName,
                    shortName: manifestShortName,
                    id: manifestId,
                    description: manifestDescription,
                    startUrl: manifestStartUrl,
                    scope: manifestScope,
                    display: manifestDisplay,
                    categories: manifestCategories,
                    themeColor: manifestThemeColor,
                    backgroundColor: manifestBackgroundColor,
                    lang: manifestLang,
                    dir: manifestDir,
                    monochrome: manifestMonochrome,
                    shortcuts: manifestShortcuts,
                    screenshots: manifestScreenshots
                };
                for (const [key, value] of Object.entries(next.manifestMetadata || {})) {
                    if (fieldMap[key]) {
                        if (fieldMap[key] === manifestMonochrome || fieldMap[key].type === 'checkbox') {
                            fieldMap[key].checked = Boolean(value);
                        } else {
                            fieldMap[key].value = Array.isArray(value) ? JSON.stringify(value) : String(value ?? '');
                        }
                    }
                }
                validateManifestMetadata();
            }
        },
        getState() {
            return {
                sourceFileName,
                sourceMode,
                originalImageData,
                cropRegion,
                draftEnabled: Boolean(draftEnabledToggle?.checked),
                draftSourceEnabled: Boolean(draftSourceToggle?.checked),
                draftClearOnExport: Boolean(draftClearOnExportToggle?.checked),
                draftStatus: draftStatus?.textContent || '',
                generatedFiles,
                activePresetKey,
                replacementTargetNames: Array.from(replacementTargetNames),
                generatedSnippets,
                assetCacheBusters: Array.from(assetCacheBusters.entries()),
                deploymentUrls: getDeploymentUrlOptions(),
                lossyQualityPercent: getLossyQualityPercent(),
                sizeBudgetBytes: getSizeBudgetBytes(),
                featureSupport: { ...featureSupport },
                generationStats: {
                    ...generationStats,
                    fallbackReasons: [...generationStats.fallbackReasons]
                },
                latestDiagnosticsSupportReport
            };
        }
    };
}

applyDraftPreferenceControls();
restoreDraftState();
window.addEventListener?.('beforeunload', () => saveDraftState({ silent: true }));

if ('serviceWorker' in navigator) {
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloadOnControllerChange) {
            saveDraftState({ silent: true });
            window.location.reload();
            return;
        }
        if (hadController) {
            showUpdateNotice('Icon Forge was updated in the background. Reload to refresh this tab.');
        }
    });
    navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'ICONFORGE_SW_ACTIVATED' && hadController && !reloadOnControllerChange) {
            showUpdateNotice('Icon Forge was updated in the background. Reload to refresh this tab.');
        }
    });
    navigator.serviceWorker.register('./sw.js')
        .then(registration => watchServiceWorker(registration, hadController))
        .catch(() => {});
}
