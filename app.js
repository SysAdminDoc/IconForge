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

const APP_VERSION = 'v0.4.22';
const MAX_CANVAS_PIXELS = 16_777_216; // Safari limit
const DRAFT_STORAGE_KEY = 'iconforge-draft-v1';

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

const OUTPUT_FORMATS = ['png', 'jpg', 'ico', 'webp', 'avif', 'svg'];
const FORMAT_LABELS = {
    png: 'PNG',
    jpg: 'JPG',
    ico: 'ICO',
    webp: 'WebP',
    avif: 'AVIF',
    svg: 'SVG'
};
const PRESET_LABELS = {
    web: 'Modern Web',
    pwa: 'PWA',
    extension: 'Extension',
    android: 'Android',
    ios: 'iOS',
    windows: 'Windows',
    social: 'Social Preview',
    all: 'All Sizes'
};
const HANDOFF_SNIPPET_TABS = [
    { key: 'plain', label: 'Plain HTML', tabId: 'handoffTabPlain' },
    { key: 'vite', label: 'Vite', tabId: 'handoffTabVite' },
    { key: 'next', label: 'Next.js app router', tabId: 'handoffTabNext' },
    { key: 'astro', label: 'Astro', tabId: 'handoffTabAstro' },
    { key: 'chrome', label: 'Chrome MV3', tabId: 'handoffTabChrome' },
    { key: 'firefox', label: 'Firefox MV3', tabId: 'handoffTabFirefox' },
    { key: 'android', label: 'Android', tabId: 'handoffTabAndroid' },
    { key: 'ios', label: 'iOS', tabId: 'handoffTabIos' }
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
const status = document.getElementById('status');
const outputSection = document.getElementById('outputSection');
const outputGrid = document.getElementById('outputGrid');
const btnDownloadAll = document.getElementById('btnDownloadAll');
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

function setElementVisible(element, visible, display = '') {
    if (!element) return;
    element.classList.toggle('is-hidden', !visible);
    element.style.display = visible ? display : 'none';
}

let draftSaveTimer = null;
let isRestoringDraft = false;

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

function buildDraftSnapshot() {
    const sourceImageDraftEnabled = Boolean(draftSourceToggle?.checked);
    const sourceImageDraft = sourceImageDraftEnabled && originalImageData && sourceImage ? {
        dataUrl: originalImageData,
        mode: sourceMode,
        name: sourceMode === 'upload' ? 'restored-image' : sourceFileName,
        width: sourceImage.naturalWidth,
        height: sourceImage.naturalHeight
    } : null;

    return {
        schema: 'iconforge-draft-v1',
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

function readDraftSnapshot() {
    const storage = draftStorage();
    if (!storage) return null;
    try {
        const raw = storage.getItem(DRAFT_STORAGE_KEY);
        if (!raw) return null;
        const draft = JSON.parse(raw);
        return draft?.schema === 'iconforge-draft-v1' ? draft : null;
    } catch {
        return null;
    }
}

function saveDraftState({ silent = false } = {}) {
    if (isRestoringDraft) return null;
    const storage = draftStorage();
    if (!storage) return null;
    let snapshot = buildDraftSnapshot();
    try {
        storage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(snapshot));
        return snapshot;
    } catch {
        if (snapshot.sourceImage) {
            snapshot = { ...snapshot, sourceImage: null };
            try {
                storage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(snapshot));
                if (!silent) setDraftStatus('Draft settings saved locally. Source image was too large for browser storage.', 'warning');
                return snapshot;
            } catch {
                // Fall through to the generic warning.
            }
        }
        if (!silent) setDraftStatus('Draft could not be saved in this browser.', 'warning');
        return null;
    }
}

function queueDraftSave() {
    if (isRestoringDraft) return;
    clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(() => saveDraftState({ silent: true }), 250);
}

function clearDraftState() {
    const storage = draftStorage();
    try {
        storage?.removeItem(DRAFT_STORAGE_KEY);
    } catch {
        setDraftStatus('Draft could not be cleared in this browser.', 'warning');
        return;
    }
    if (draftSourceToggle) draftSourceToggle.checked = false;
    setDraftStatus('Saved draft cleared. Current work stays open until you reload or choose a different source.', 'success');
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
        setDraftStatus('Draft settings restored, but the saved source image could not be loaded.', 'warning');
        return false;
    }
}

async function restoreDraftState() {
    const draft = readDraftSnapshot();
    if (!draft) return;
    isRestoringDraft = true;
    let restoredCleanly = false;
    try {
        applyDraftControls(draft);
        const sourceRestored = await restoreDraftSourceImage(draft);
        setDraftStatus(sourceRestored
            ? 'Draft restored locally, including the saved source image.'
            : 'Draft settings restored locally. Enable source restore to keep the image across reloads.',
            sourceRestored ? 'success' : '');
        restoredCleanly = true;
    } catch {
        setDraftStatus('Saved draft could not be restored. Clear Draft removes the broken local copy.', 'warning');
    } finally {
        isRestoringDraft = false;
        if (restoredCleanly) saveDraftState({ silent: true });
    }
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
        return { label, status: 'info', detail: 'Checking browser support.' };
    }
    return {
        label,
        status: supported ? 'pass' : 'warn',
        detail: supported ? detailSupported : detailUnsupported
    };
}

function getFeatureDiagnostics() {
    return [
        supportCheck(
            'WebP encoder',
            featureSupport.webpEncode,
            'WebP output is available.',
            'WebP output is hidden because this browser cannot encode it.',
            !featureSupport.webpChecked
        ),
        supportCheck(
            'AVIF encoder',
            featureSupport.avifEncode,
            'AVIF output is available.',
            'AVIF output is hidden because this browser cannot encode it.',
            !featureSupport.avifChecked
        ),
        supportCheck(
            'File System Access',
            featureSupport.fileSystemAccess,
            'Save to Folder is available.',
            'ZIP download remains available; direct folder save is hidden.'
        ),
        supportCheck(
            'PWA file handling',
            featureSupport.fileHandling,
            'Installed app launches can receive image files.',
            'Open-with-file support is unavailable; upload, paste, and drag/drop still work.'
        ),
        supportCheck(
            'OffscreenCanvas',
            featureSupport.offscreenCanvas,
            'Worker resizing can use OffscreenCanvas.',
            'Canvas fallback will be used for image resizing.'
        ),
        supportCheck(
            'Blob Worker',
            featureSupport.workerApi && featureSupport.blobWorker,
            'Resize worker initialized.',
            featureSupport.workerApi ? 'Resize worker did not initialize; canvas fallback is available.' : 'Worker API is unavailable; canvas fallback is available.'
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

    return {
        title: error ? 'Generation failed' : 'Generation diagnostics',
        detail: error ? error.message : `${fileCountText} generated for ${PRESET_LABELS[activePresetKey] || 'Custom'} export.`,
        metrics: [
            { label: 'Selected preset', value: PRESET_LABELS[activePresetKey] || 'Custom' },
            { label: 'Selected formats', value: selectedFormatText },
            { label: 'Skipped / hidden formats', value: skippedFormats.length ? skippedFormats.join('; ') : 'None' },
            { label: 'Worker fallback state', value: getWorkerDiagnostics() },
            { label: 'Lossy quality', value: `${getLossyQualityPercent()}% for JPG/WebP/AVIF` },
            { label: 'Size budget', value: getSizeBudgetStatus(totalBytes) },
            { label: 'Generated file count', value: String(generatedFiles.length) },
            { label: 'Total bytes', value: totalBytes ? formatFileSize(totalBytes) : '0 B' },
            { label: 'Validation status', value: validationStatus }
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
    document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.mode-tab[data-mode="${nextMode}"]`)?.classList.add('active');
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
btnDownloadAll.addEventListener('click', downloadAll);
draftSourceToggle?.addEventListener('change', () => {
    saveDraftState({ silent: false });
});
btnClearDraft?.addEventListener('click', clearDraftState);
btnCopyDiagnostics?.addEventListener('click', async function() {
    try {
        await navigator.clipboard.writeText(diagnosticsSupportJson());
        showCopyFeedback(this);
        showStatus('Diagnostics JSON copied', 'success');
    } catch {
        showStatus('Failed to copy diagnostics JSON', 'error');
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
        showStatus('Diagnostics JSON downloaded', 'success');
    } catch (error) {
        showStatus(`Failed to download diagnostics JSON: ${error.message}`, 'error');
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

const btnSaveToFolder = document.getElementById('btnSaveToFolder');
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

async function readZipFileNames(file) {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const min = Math.max(0, bytes.length - 65557);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= min; i--) {
        if (view.getUint32(i, true) === 0x06054b50) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0) throw new Error('ZIP directory not found');
    const totalEntries = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);
    const decoder = new TextDecoder();
    const names = [];

    for (let i = 0; i < totalEntries; i++) {
        if (view.getUint32(offset, true) !== 0x02014b50) break;
        const nameLen = view.getUint16(offset + 28, true);
        const extraLen = view.getUint16(offset + 30, true);
        const commentLen = view.getUint16(offset + 32, true);
        const nameStart = offset + 46;
        names.push(decoder.decode(bytes.slice(nameStart, nameStart + nameLen)));
        offset = nameStart + nameLen + extraLen + commentLen;
    }
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
            throw new Error('Please select a valid image file.');
        }

        const sizeMB = file.size / (1024 * 1024);
        if (sizeMB > 200) {
            throw new Error(`File too large (${sizeMB.toFixed(0)} MB). Maximum is 200 MB.`);
        }
        if (sizeMB > 50) {
            showStatus(`Large file (${sizeMB.toFixed(0)} MB) - processing may be slow.`, 'warning');
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
            showStatus(`Image was downscaled from ${img.naturalWidth}x${img.naturalHeight} to ${safeSize.width}x${safeSize.height} (browser canvas limit)`, 'warning');
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
            ? `Opened ${file.name}; ${handles.length - 1} additional file${handles.length === 2 ? '' : 's'} ignored.`
            : `Opened ${file.name} from the operating system.`,
            handles.length > 1 ? 'warning' : 'success');
        return true;
    } catch (error) {
        showStatus(`Could not open launched file: ${error.message}`, 'error');
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

function initWorker() {
    try {
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        resizeWorker = new Worker(url);
        featureSupport.blobWorker = true;
        resizeWorker.onmessage = (e) => {
            const cb = workerCallbacks.get(e.data.id);
            if (cb) {
                workerCallbacks.delete(e.data.id);
                if (e.data.error) cb(null, e.data.error);
                else cb(e.data.blob);
            }
        };
        resizeWorker.onerror = () => {
            resizeWorker = null;
            featureSupport.blobWorker = false;
        };
        URL.revokeObjectURL(url);
    } catch {
        resizeWorker = null;
        featureSupport.blobWorker = false;
    }
}
initWorker();

// Feature-detect WebP and AVIF encoding support
(function detectFormats() {
    const c = document.createElement('canvas');
    c.width = 1; c.height = 1;
    c.toBlob((blob) => {
        featureSupport.webpChecked = true;
        featureSupport.webpEncode = Boolean(blob && blob.type === 'image/webp');
        if (blob && blob.type === 'image/webp') {
            setElementVisible(document.getElementById('webpFormatOption'), true);
        }
        c.toBlob((blob2) => {
            featureSupport.avifChecked = true;
            featureSupport.avifEncode = Boolean(blob2 && blob2.type === 'image/avif');
            if (blob2 && blob2.type === 'image/avif') {
                setElementVisible(document.getElementById('avifFormatOption'), true);
            }
            c.width = 0; c.height = 0;
        }, 'image/avif');
    }, 'image/webp');
})();

function resizeInWorker(bitmap, width, height, format, crop, quality) {
    return new Promise((resolve, reject) => {
        const id = ++workerJobId;
        const timer = setTimeout(() => {
            workerCallbacks.delete(id);
            reject(new Error('Worker resize timed out after 30s'));
        }, 30000);
        workerCallbacks.set(id, (blobOrNull, errorMsg) => {
            clearTimeout(timer);
            if (errorMsg) reject(new Error(errorMsg));
            else resolve(blobOrNull);
        });
        resizeWorker.postMessage({ id, bitmap, width, height, format, crop, quality }, [bitmap]);
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

async function generateIcons() {
    if (!sourceImage) return;

    const sizes = getSelectedSizes();
    const formats = getSelectedFormats();

    if (sizes.length === 0) {
        showStatus('Please select at least one size', 'warning');
        return;
    }

    if (formats.length === 0) {
        showStatus('Please select at least one format', 'warning');
        return;
    }

    btnGenerate.disabled = true;
    btnGenerate.innerHTML = '<span class="spinner"></span> Generating...';
    showStatus('Generating icons...', 'info');

    revokeOutputUrls();
    outputGrid.innerHTML = '';
    generatedFiles = [];
    generatedSnippets = {};
    generationStats = createGenerationStats();

    const totalOps = Math.max(1, formats.reduce((n, f) => n + (f === 'ico' || f === 'svg' ? 1 : sizes.length), 0));
    let completedOps = 0;

    try {
        const imgSource = sourceImage;
        const crop = cropRegion;

        for (const format of formats) {
            if (format === 'ico') {
                const icoSizes = sizes.filter(s => s.width <= 256 && s.width === s.height);
                if (icoSizes.length > 0) {
                    const blob = await generateICO(imgSource, icoSizes, crop);
                    const fileName = getOutputFileName({ format, size: { width: 'multi', height: 'multi' } });
                    addGeneratedFile(fileName, blob, { width: 'multi', height: 'multi' }, 'ico', { icoSizes });
                }
                completedOps++;
                showStatus(`Generating... ${completedOps}/${totalOps}`, 'info');
            } else if (format === 'svg') {
                const svgStr = generateSvgFavicon(imgSource, crop);
                const blob = new Blob([svgStr], { type: 'image/svg+xml' });
                const fileName = getOutputFileName({ format, size: { width: 'svg', height: '' } });
                addGeneratedFile(fileName, blob, { width: 'svg', height: '' }, 'svg');
                completedOps++;
                showStatus(`Generating... ${completedOps}/${totalOps}`, 'info');
            } else {
                for (const size of sizes) {
                    const { blob } = await generateImage(imgSource, size, format, crop);
                    const fileName = getOutputFileName({ format, size });
                    addGeneratedFile(fileName, blob, size, format, getGeneratedFileMeta(format, size));
                    completedOps++;
                    showStatus(`Generating... ${completedOps}/${totalOps}`, 'info');
                }
            }
        }

        await generatePlatformBundle(imgSource, crop, sizes, formats);
        setElementVisible(outputSection, true, 'block');
        const totalSize = generatedFiles.reduce((s, f) => s + f.blob.size, 0);
        const budgetBytes = getSizeBudgetBytes();
        const budgetImpact = budgetBytes ? `; ${getSizeBudgetStatus(totalSize)}` : '';
        showStatus(`Generated ${generatedFiles.length} files (${formatFileSize(totalSize)} total${budgetImpact})`, 'success');
        await generateSnippets(sizes, formats);
        const validationResult = renderExportValidation();
        renderGenerationDiagnostics({ selectedFormats: formats, validationResult });
    } catch (error) {
        setElementVisible(outputSection, true, 'block');
        renderGenerationDiagnostics({ selectedFormats: formats, error });
        showStatus(`Error: ${error.message}`, 'error');
        console.error(error);
    }

    btnGenerate.disabled = false;
    btnGenerate.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
        </svg>
        Generate Icons
    `;
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

async function canvasToOutputBlob(canvas, mimeType, quality, context) {
    let blob = null;
    try {
        blob = await new Promise((resolve, reject) => {
            if (!canvas || typeof canvas.toBlob !== 'function') {
                reject(new Error('Canvas encoding is unavailable in this browser.'));
                return;
            }
            canvas.toBlob(resolve, mimeType, quality);
        });
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
            resizeWorker = null;
            featureSupport.blobWorker = false;
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

async function generatePlatformBundle(img, crop, sizes, formats) {
    if (activePresetKey === 'pwa') {
        await generatePwaBundle(img, crop);
    } else if (activePresetKey === 'android') {
        await generateAndroidBundle(img, crop);
    } else if (activePresetKey === 'ios') {
        await generateIosBundle(img, crop);
    } else if (activePresetKey === 'windows') {
        await generateWindowsBundle(img, crop);
    }
}

const PWA_ICON_SIZES = [72, 96, 128, 144, 152, 192, 384, 512];
const PWA_SPLASH_SPECS = [
    { width: 2048, height: 2732, name: 'ipad-pro-12-9' },
    { width: 1668, height: 2388, name: 'ipad-pro-11' },
    { width: 1536, height: 2048, name: 'ipad-9-7' },
    { width: 1640, height: 2360, name: 'ipad-air-11' },
    { width: 1668, height: 2224, name: 'ipad-air-10-5' },
    { width: 1620, height: 2160, name: 'ipad-10-2' },
    { width: 1488, height: 2266, name: 'ipad-mini-8-3' },
    { width: 1320, height: 2868, name: 'iphone-16-pro-max' },
    { width: 1206, height: 2622, name: 'iphone-16-pro' },
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

async function generatePwaBundle(img, crop) {
    for (const px of PWA_ICON_SIZES) {
        const anyName = `pwa/icons/icon-${px}x${px}.png`;
        if (!hasGeneratedFile(anyName)) {
            const blob = await renderIconBlob(img, px, px, crop, getProcessingOptions(), 'png');
            addGeneratedFile(anyName, blob, { width: px, height: px }, 'png', { purpose: 'any' });
        }

        const maskName = `pwa/icons/icon-maskable-${px}x${px}.png`;
        const blob = await renderIconBlob(img, px, px, crop, getProcessingOptions({
            paddingPercent: Math.max(parseInt(safePaddingSlider.value, 10) || 0, 12),
            backgroundMode: backgroundMode.value === 'transparent' ? 'solid' : backgroundMode.value
        }), 'png');
        addGeneratedFile(maskName, blob, { width: px, height: px }, 'png', { purpose: 'maskable' });
    }

    for (const splash of PWA_SPLASH_SPECS) {
        const portraitName = `pwa/splash/apple-splash-${splash.name}-${splash.width}x${splash.height}.png`;
        const portrait = await renderSplashBlob(img, splash.width, splash.height, crop);
        addGeneratedFile(portraitName, portrait, splash, 'png', { role: 'splash' });

        const landscapeName = `pwa/splash/apple-splash-${splash.name}-${splash.height}x${splash.width}.png`;
        const landscape = await renderSplashBlob(img, splash.height, splash.width, crop);
        addGeneratedFile(landscapeName, landscape, { width: splash.height, height: splash.width }, 'png', { role: 'splash' });
    }
}

async function generateAndroidBundle(img, crop) {
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
        const foreground = await renderIconBlob(img, spec.adaptive, spec.adaptive, crop, foregroundOptions, 'png');
        addGeneratedFile(`${basePath}/ic_launcher_foreground.png`, foreground, { width: spec.adaptive, height: spec.adaptive }, 'png', {
            role: 'android-foreground',
            density: spec.density
        });

        const background = await renderBackgroundBlob(spec.adaptive, spec.adaptive);
        addGeneratedFile(`${basePath}/ic_launcher_background.png`, background, { width: spec.adaptive, height: spec.adaptive }, 'png', {
            role: 'android-background',
            density: spec.density
        });

        const legacy = await renderIconBlob(img, spec.legacy, spec.legacy, crop, legacyOptions, 'png');
        addGeneratedFile(`${basePath}/ic_launcher.png`, legacy, { width: spec.legacy, height: spec.legacy }, 'png', {
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

async function generateIosBundle(img, crop) {
    for (const [idiom, pointSize, scale, pixels] of IOS_ICON_SPECS) {
        const name = `ios/AppIcon.appiconset/${iosIconFileName(pointSize, scale)}`;
        const blob = await renderIconBlob(img, pixels, pixels, crop, getProcessingOptions({
            paddingPercent: Math.max(parseInt(safePaddingSlider.value, 10) || 0, 4),
            backgroundMode: backgroundMode.value === 'transparent' ? 'solid' : backgroundMode.value
        }), 'png');
        addGeneratedFile(name, blob, { width: pixels, height: pixels }, 'png', { role: 'ios', idiom, pointSize, scale });
    }
}

async function generateWindowsBundle(img, crop) {
    for (const tile of WINDOWS_TILE_SPECS) {
        const name = `windows/mstile-${tile.width}x${tile.height}.png`;
        if (hasGeneratedFile(name)) continue;
        const blob = await renderIconBlob(img, tile.width, tile.height, crop, getProcessingOptions({
            paddingPercent: Math.max(parseInt(safePaddingSlider.value, 10) || 0, 10),
            backgroundMode: backgroundMode.value === 'transparent' ? 'solid' : backgroundMode.value
        }), 'png');
        addGeneratedFile(name, blob, tile, 'png', { role: 'windows-tile' });
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

function assetPathFor(name) {
    return normalizedFileName(name).replace(/^\/+/, '');
}

function normalizeAssetBase(base) {
    const value = String(base || '').trim();
    if (!value) return '/';
    return value.endsWith('/') ? value : `${value}/`;
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
    if (!deploymentUrlStatus) return getDeploymentUrlOptions();
    const deployment = getDeploymentUrlOptions();
    const modeLabel = deployment.mode === 'relative'
        ? 'Relative URLs'
        : deployment.mode === 'custom'
            ? `Custom base: ${normalizeAssetBase(deployment.customBase)}`
            : 'Root-relative URLs';
    deploymentUrlStatus.textContent = deployment.cacheBust ? `${modeLabel}, SHA-256 queries` : modeLabel;
    deploymentUrlStatus.classList.toggle('error', deployment.mode === 'custom' && !deployment.customBase);
    return deployment;
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
    if (id && /\s/.test(id)) errors.push('ID cannot contain whitespace. Use an encoded URL-style ID.');
    if (!MANIFEST_DISPLAY_MODES.has(display)) errors.push('Display must be fullscreen, standalone, minimal-ui, or browser.');
    if (dir && !MANIFEST_DIRECTIONS.has(dir)) errors.push('Direction must be auto, ltr, or rtl.');

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
    manifestMetadataGrid.addEventListener('input', () => {
        validateManifestMetadata();
        queueDraftSave();
    });
    manifestMetadataGrid.addEventListener('change', () => {
        validateManifestMetadata();
        queueDraftSave();
    });
    validateManifestMetadata();
}

async function handleDeploymentUrlChange() {
    validateDeploymentUrlOptions();
    queueDraftSave();
    if (generatedFiles.length === 0) return;
    try {
        await generateSnippets(getSelectedSizes(), getSelectedFormats());
        const validationResult = renderExportValidation();
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
        .filter(file => file.purpose !== 'maskable' && !file.name.includes('maskable'))
        .sort((a, b) => b.size.width - a.size.width)[0] || null;
}

function buildManifestSnippet() {
    const iconFiles = manifestIconFiles();
    const icons = iconFiles.map(file => manifestIconEntry(file));
    if (manifestMonochromeEnabled()) {
        const monochromeFile = monochromeManifestIconFile(iconFiles);
        if (monochromeFile) icons.push(manifestIconEntry(monochromeFile, 'monochrome'));
    }

    if (icons.length === 0) return '';
    validateManifestMetadata();
    const { metadata } = getManifestMetadata();
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
      <square70x70logo src="${hrefFor('windows/mstile-70x70.png')}"/>
      <square150x150logo src="${hrefFor('windows/mstile-150x150.png')}"/>
      <wide310x150logo src="${hrefFor('windows/mstile-310x150.png')}"/>
      <square310x310logo src="${hrefFor('windows/mstile-310x310.png')}"/>
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
        `<meta property="og:image" content="${hrefFor(og.name)}">`,
        `<meta property="og:image:width" content="${og.size.width}">`,
        `<meta property="og:image:height" content="${og.size.height}">`,
        `<meta property="og:image:alt" content="${alt}">`,
        '<meta name="twitter:card" content="summary_large_image">',
        `<meta name="twitter:title" content="${title}">`,
        `<meta name="twitter:description" content="${description}">`,
        `<meta name="twitter:image" content="${hrefFor(twitter.name)}">`
    ];
    return lines.join('\n');
}

function generatedFileCopyList(prefix = '') {
    if (generatedFiles.length === 0) return '- No generated files yet';
    return generatedFiles
        .map(file => `- ${prefix}${normalizedFileName(file.name)}`)
        .join('\n');
}

function webManifestHref(manifest) {
    if (!manifest) return '';
    return deploymentUrlFor(activePresetKey === 'pwa' ? 'pwa/manifest.webmanifest' : 'manifest.webmanifest', { cacheBust: false });
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
    return `<!-- Plain HTML: paste into <head> -->\n${html || '<!-- No applicable tags for selected formats -->'}`;
}

function buildViteHandoffSnippet(html, manifest) {
    const manifestPath = webManifestHref(manifest).replace(/^\//, '');
    const supportFiles = manifestPath ? `\n- public/${manifestPath}` : '';
    return `# Vite public/ handoff
Copy the generated files into public/ with these paths:
${generatedFileCopyList('public/')}${supportFiles}

Add the generated tags to index.html:
${html || '<!-- No applicable tags for selected formats -->'}`;
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
        return 'Run the Android preset to generate adaptive icon PNGs and ic_launcher.xml handoff files.';
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
        return 'Run the iOS preset to generate AppIcon.appiconset PNGs and Contents.json.';
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

    if (icoFile) lines.push(`<link rel="icon" href="${hrefFor(icoFile.name)}" sizes="32x32">`);
    if (svgFile) lines.push(`<link rel="icon" href="${hrefFor(svgFile.name)}" type="image/svg+xml">`);
    if (appleFile) lines.push(`<link rel="apple-touch-icon" href="${hrefFor(appleFile.name)}">`);
    if (manifest) lines.push(`<link rel="manifest" href="${webManifestHref(manifest)}">`);
    for (const splash of splashFiles) {
        lines.push(`<link rel="apple-touch-startup-image" href="${hrefFor(splash.name)}" media="(device-width: ${splash.size.width}px) and (device-height: ${splash.size.height}px)">`);
    }
    if (activePresetKey === 'windows') {
        lines.push(`<meta name="msapplication-config" content="${deploymentUrlFor('windows/browserconfig.xml', { cacheBust: false })}">`);
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

function addValidationCheck(checks, status, label, detail) {
    checks.push({ status, label, detail });
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
        return [
            {
                label: 'PWA icon files',
                specs: PWA_ICON_SIZES.flatMap(px => [
                    { name: `pwa/icons/icon-${px}x${px}.png`, width: px, height: px },
                    { name: `pwa/icons/icon-maskable-${px}x${px}.png`, width: px, height: px }
                ])
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

function validateSupportFiles(checks) {
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
    if (missing.length) {
        addValidationCheck(checks, 'fail', 'Deployable support files', `Missing: ${fileSpecSummary(missing)}`);
    } else {
        addValidationCheck(checks, 'pass', 'Deployable support files', `${expected.length} support file${expected.length === 1 ? '' : 's'} will be included in ZIP/folder export.`);
    }
}

function validateManifestIcons(checks) {
    if (activePresetKey !== 'web' && activePresetKey !== 'pwa') return;
    const relevantIcons = manifestIconFiles();

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
        for (const file of relevantIcons) {
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
            const iconCount = relevantIcons.length + (manifestMonochromeEnabled() && monochromeManifestIconFile(relevantIcons) ? 1 : 0);
            addValidationCheck(checks, 'pass', 'Manifest icon metadata', `${iconCount} generated icon${iconCount === 1 ? '' : 's'} match manifest src, sizes, type, and purpose.`);
        }
    } catch (error) {
        addValidationCheck(checks, 'fail', 'Manifest icon metadata', `Manifest JSON is invalid: ${error.message}`);
    }
}

function validateMaskableSafeZone(checks) {
    const maskableFiles = generatedFiles.filter(file => file.purpose === 'maskable' || file.name.includes('maskable'));
    if (activePresetKey !== 'pwa' && maskableFiles.length === 0) return;
    if (maskableFiles.length === 0) {
        addValidationCheck(checks, 'fail', 'Maskable safe zone', 'No maskable PWA icons were generated.');
        return;
    }
    const effectivePadding = Math.max(parseInt(safePaddingSlider.value, 10) || 0, 12);
    if (effectivePadding < 12) {
        addValidationCheck(checks, 'warn', 'Maskable safe zone', 'Maskable icons should keep at least 12% safe padding.');
    } else {
        addValidationCheck(checks, 'pass', 'Maskable safe zone', `${maskableFiles.length} maskable icon${maskableFiles.length === 1 ? '' : 's'} use at least ${effectivePadding}% safe padding.`);
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

function validateGeneratedExport() {
    const checks = [];
    if (generatedFiles.length === 0) {
        addValidationCheck(checks, 'fail', 'Generated files', 'No generated files are available to validate.');
    } else {
        addValidationCheck(checks, 'pass', 'Generated files', `${generatedFiles.length} image file${generatedFiles.length === 1 ? '' : 's'} generated.`);
    }

    const groups = expectedPresetFileGroups();
    for (const group of groups) checkFileSet(checks, group.label, group.specs);
    if (groups.length === 0 && activePresetKey) {
        addValidationCheck(checks, 'warn', 'Platform file rules', `No strict validator is defined for preset "${activePresetKey}".`);
    } else if (groups.length === 0) {
        addValidationCheck(checks, 'warn', 'Platform file rules', 'Custom exports validate generated files and support files only.');
    }

    validateManifestIcons(checks);
    validateMaskableSafeZone(checks);
    validateSupportFiles(checks);
    validateSizeBudget(checks);

    const status = checks.some(check => check.status === 'fail') ? 'fail' : checks.some(check => check.status === 'warn') ? 'warn' : 'pass';
    return {
        status,
        title: status === 'pass' ? 'Export validation passed' : status === 'warn' ? 'Export validation has warnings' : 'Export validation failed',
        detail: status === 'pass'
            ? 'The generated bundle matches the selected platform rules.'
            : 'Review the checks below before deploying this export.',
        checks
    };
}

function renderExportValidation() {
    const section = document.getElementById('validationSection');
    const summary = document.getElementById('validationSummary');
    const list = document.getElementById('validationList');
    const result = validateGeneratedExport();

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
    try {
        const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        const exportFiles = await getExportFilesWithManifest();
        for (const file of exportFiles) {
            await writeFileToDirectory(dirHandle, file.name, file.blob);
        }
        showStatus(`Saved ${exportFiles.length} files to folder`, 'success');
    } catch (err) {
        if (err.name !== 'AbortError') {
            showStatus(`Error saving: ${err.message}`, 'error');
        }
    }
}

async function writeFileToDirectory(rootHandle, path, blob) {
    const parts = path.split('/').filter(Boolean);
    let dir = rootHandle;
    for (const part of parts.slice(0, -1)) {
        dir = await dir.getDirectoryHandle(part, { create: true });
    }
    const fileHandle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
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
        return;
    }
    status.className = `status visible ${type}`;
    status.textContent = message;
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
        createICO,
        cleanPathSegment,
        baseName,
        normalizeTemplateName,
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
        buildDraftSnapshot,
        readDraftSnapshot,
        saveDraftState,
        clearDraftState,
        applyDraftControls,
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
            if (Object.prototype.hasOwnProperty.call(next, 'draftSourceEnabled')) draftSourceToggle.checked = Boolean(next.draftSourceEnabled);
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
                draftSourceEnabled: Boolean(draftSourceToggle?.checked),
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
