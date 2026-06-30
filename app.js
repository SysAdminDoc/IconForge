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
        v.setUint16(8, 0, true);
        v.setUint16(14, 0, true);
        v.setUint16(16, 0, true);
        v.setUint32(18, crc, true);
        v.setUint32(22, data.length, true);
        v.setUint32(26, data.length, true);
        v.setUint16(28, nameBytes.length, true);
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

const MAX_CANVAS_PIXELS = 16_777_216; // Safari limit

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
let generatedFiles = [];
let activePresetKey = null;
let replacementTargetNames = new Set();
let generatedSnippets = {};

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
    all: 'All Sizes'
};
const HANDOFF_SNIPPET_TABS = [
    { key: 'plain', label: 'Plain HTML' },
    { key: 'vite', label: 'Vite' },
    { key: 'next', label: 'Next.js app router' },
    { key: 'astro', label: 'Astro' },
    { key: 'chrome', label: 'Chrome MV3' },
    { key: 'firefox', label: 'Firefox MV3' },
    { key: 'android', label: 'Android' },
    { key: 'ios', label: 'iOS' }
];
const featureSupport = {
    workerApi: typeof Worker !== 'undefined',
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    fileSystemAccess: typeof window !== 'undefined' && 'showDirectoryPicker' in window,
    blobWorker: false,
    webpEncode: false,
    webpChecked: false,
    avifEncode: false,
    avifChecked: false
};
let generationStats = createGenerationStats();
let activeHandoffSnippetKey = 'plain';

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
const handoffTabs = document.getElementById('handoffTabs');
const handoffSnippetTitle = document.getElementById('handoffSnippetTitle');
const handoffSnippet = document.getElementById('handoffSnippet');
const safePaddingSlider = document.getElementById('safePaddingSlider');
const safePaddingValue = document.getElementById('safePaddingValue');
const resampleSelect = document.getElementById('resampleSelect');
const backgroundMode = document.getElementById('backgroundMode');
const backgroundColor = document.getElementById('backgroundColor');
const backgroundColor2 = document.getElementById('backgroundColor2');
const manifestMetadataGrid = document.getElementById('manifestMetadataGrid');
const manifestMetadataStatus = document.getElementById('manifestMetadataStatus');
const manifestName = document.getElementById('manifestName');
const manifestShortName = document.getElementById('manifestShortName');
const manifestDescription = document.getElementById('manifestDescription');
const manifestStartUrl = document.getElementById('manifestStartUrl');
const manifestScope = document.getElementById('manifestScope');
const manifestDisplay = document.getElementById('manifestDisplay');
const manifestCategories = document.getElementById('manifestCategories');
const manifestThemeColor = document.getElementById('manifestThemeColor');
const manifestBackgroundColor = document.getElementById('manifestBackgroundColor');
const manifestLang = document.getElementById('manifestLang');
const manifestDir = document.getElementById('manifestDir');
const manifestShortcuts = document.getElementById('manifestShortcuts');
const manifestScreenshots = document.getElementById('manifestScreenshots');
const effectSelect = document.getElementById('effectSelect');
const dropShadowToggle = document.getElementById('dropShadowToggle');
const maskPreviewCanvas = document.getElementById('maskPreviewCanvas');
const maskPreviewCtx = maskPreviewCanvas.getContext('2d');
const maskShapeSelect = document.getElementById('maskShapeSelect');
const replaceInput = document.getElementById('replaceInput');
const replaceStatus = document.getElementById('replaceStatus');

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
            { label: 'Generated file count', value: String(generatedFiles.length) },
            { label: 'Total bytes', value: totalBytes ? formatFileSize(totalBytes) : '0 B' },
            { label: 'Validation status', value: validationStatus }
        ],
        features: getFeatureDiagnostics()
    };
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
    const diagnostics = buildGenerationDiagnostics(options);

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
    document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
    document.querySelector('.mode-tab[data-mode="upload"]').classList.add('active');
    setElementVisible(uploadMode, true);
    setElementVisible(textMode, false);
    setElementVisible(emojiMode, false);
}

// Input mode tabs
const uploadMode = document.getElementById('uploadMode');
const textMode = document.getElementById('textMode');
const emojiMode = document.getElementById('emojiMode');
document.querySelector('.input-mode-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.mode-tab');
    if (!tab) return;
    document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const mode = tab.dataset.mode;
    setElementVisible(uploadMode, mode === 'upload');
    setElementVisible(textMode, mode === 'text');
    setElementVisible(emojiMode, mode === 'emoji');
    if (mode === 'text') renderTextPreview();
    if (mode === 'emoji') renderEmojiPreview();
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
});

[textInput, fontSelect, textColor, textBgColor].forEach(el => {
    el.addEventListener('input', renderTextPreview);
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
});

emojiBgColor.addEventListener('input', renderEmojiPreview);

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
[safePaddingSlider, resampleSelect, backgroundMode, backgroundColor, backgroundColor2, effectSelect, dropShadowToggle, maskShapeSelect].forEach(el => {
    el.addEventListener('input', () => {
        safePaddingValue.textContent = `${safePaddingSlider.value}%`;
        updateMaskPreview();
    });
    el.addEventListener('change', () => {
        safePaddingValue.textContent = `${safePaddingSlider.value}%`;
        updateMaskPreview();
    });
});
replaceInput.addEventListener('change', handleReplacementTemplate);

const btnSaveToFolder = document.getElementById('btnSaveToFolder');
if ('showDirectoryPicker' in window) {
    setElementVisible(btnSaveToFolder, true);
    btnSaveToFolder.addEventListener('click', saveToFolder);
}

handoffTabs?.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-handoff-tab]');
    if (!tab) return;
    activeHandoffSnippetKey = tab.dataset.handoffTab;
    renderHandoffSnippetTabs();
});

// Preset buttons
const PRESETS = {
    web:       { sizes: [16, 32, 48, 180, 192, 512], formats: ['png', 'ico', 'svg'] },
    pwa:       { sizes: [72, 96, 128, 144, 152, 192, 384, 512], formats: ['png'] },
    extension: { sizes: [16, 32, 48, 128], formats: ['png'] },
    android:   { sizes: [192, 512], formats: ['png'] },
    ios:       { sizes: [180, 512], formats: ['png'] },
    windows:   { sizes: [70, 150, 310, { width: 310, height: 150 }], formats: ['png', 'ico'] },
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
});

// Crop Event Listeners
btnAutoCrop.addEventListener('click', performAutoCrop);
btnManualCrop.addEventListener('click', toggleManualCropMode);
btnResetCrop.addEventListener('click', resetCrop);
btnApplyCrop.addEventListener('click', applyCrop);
toleranceSlider.addEventListener('input', (e) => {
    toleranceValue.textContent = e.target.value;
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

function loadImage(file) {
    if (!file.type.startsWith('image/') && !file.name.endsWith('.svg')) {
        showStatus('Please select a valid image file', 'error');
        return;
    }

    const sizeMB = file.size / (1024 * 1024);
    if (sizeMB > 200) {
        showStatus(`File too large (${sizeMB.toFixed(0)} MB). Maximum is 200 MB.`, 'error');
        return;
    }
    if (sizeMB > 50) {
        showStatus(`Large file (${sizeMB.toFixed(0)} MB) — processing may be slow.`, 'warning');
    }

    sourceFileName = file.name.replace(/\.[^/.]+$/, '');
    
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            // Downscale if image exceeds safe canvas limits
            const safeSize = limitImageSize(img.naturalWidth, img.naturalHeight);
            if (safeSize.scaled) {
                const tmpCanvas = document.createElement('canvas');
                tmpCanvas.width = safeSize.width;
                tmpCanvas.height = safeSize.height;
                const tmpCtx = tmpCanvas.getContext('2d');
                tmpCtx.drawImage(img, 0, 0, safeSize.width, safeSize.height);
                const scaledImg = new Image();
                scaledImg.onload = () => {
                    sourceImage = scaledImg;
                    originalImageData = tmpCanvas.toDataURL('image/png');
                    previewImage.src = originalImageData;
                    setPreviewInfo(file.name, safeSize.width, safeSize.height, `downscaled from ${img.naturalWidth}×${img.naturalHeight}`);
                    showStatus(`Image was downscaled from ${img.naturalWidth}×${img.naturalHeight} to ${safeSize.width}×${safeSize.height} (browser canvas limit)`, 'warning');
                    setElementVisible(dropZone, false);
                    previewContainer.classList.add('active');
                    btnGenerate.disabled = false;
                    setElementVisible(outputSection, false);
                    cropSection.classList.add('active');
                    cropRegion = null;
                    initCropCanvas();
                    updateMaskPreview();
                    tmpCanvas.width = 0;
                    tmpCanvas.height = 0;
                };
                scaledImg.src = tmpCanvas.toDataURL('image/png');
                return;
            }

            sourceImage = img;
            originalImageData = e.target.result;
            previewImage.src = e.target.result;
            setPreviewInfo(file.name, img.naturalWidth, img.naturalHeight);
            setElementVisible(dropZone, false);
            previewContainer.classList.add('active');
            btnGenerate.disabled = false;
            setElementVisible(outputSection, false);
            showStatus('', '');

            // Initialize crop section
            cropSection.classList.add('active');
            cropRegion = null;
            initCropCanvas();
            updateMaskPreview();
        };
        img.onerror = () => {
            showStatus('Failed to load image. Make sure it\'s a valid image file.', 'error');
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function resetInput() {
    sourceImage = null;
    sourceFileName = '';
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

function resizeInWorker(bitmap, width, height, format, crop) {
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
        resizeWorker.postMessage({ id, bitmap, width, height, format, crop }, [bitmap]);
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

    const lightColor = document.getElementById('svgLightColor').value;
    const darkColor = document.getElementById('svgDarkColor').value;

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgSize} ${svgSize}">
  <link rel="stylesheet" href="styles.css">
  <rect width="${svgSize}" height="${svgSize}" rx="6"/>
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
                    addGeneratedFile(fileName, blob, size, format);
                    completedOps++;
                    showStatus(`Generating... ${completedOps}/${totalOps}`, 'info');
                }
            }
        }

        await generatePlatformBundle(imgSource, crop, sizes, formats);
        setElementVisible(outputSection, true, 'block');
        const totalSize = generatedFiles.reduce((s, f) => s + f.blob.size, 0);
        showStatus(`Generated ${generatedFiles.length} files (${formatFileSize(totalSize)} total)`, 'success');
        generateSnippets(sizes, formats);
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

async function generateImage(img, size, format, crop = null, bitmap = null) {
    const options = getProcessingOptions({ backgroundMode: format === 'jpg' && backgroundMode.value === 'transparent' ? 'solid' : backgroundMode.value });
    const customProcessing = usesCustomProcessing(options);
    if (resizeWorker && featureSupport.offscreenCanvas && !customProcessing) {
        try {
            const bmp = bitmap || await createImageBitmap(img);
            const blob = await resizeInWorker(bmp, size.width, size.height, format, crop);
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
    const quality = format === 'png' ? undefined : 0.92;

    const blob = await new Promise(resolve => canvas.toBlob(resolve, mimeType, quality));
    canvas.width = 0;
    canvas.height = 0;
    await new Promise(r => setTimeout(r, 0));
    return { blob };
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    return (bytes / 1024).toFixed(1) + ' KB';
}

function addGeneratedFile(name, blob, size, format, meta = {}) {
    const existingIndex = generatedFiles.findIndex(file => file.name === name);
    const file = { name, blob, size, format, ...meta };
    if (existingIndex >= 0) {
        generatedFiles[existingIndex] = file;
    } else {
        generatedFiles.push(file);
    }
    addOutputItem(name, blob, size, format, meta.icoSizes || null, blob.size);
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
    if (format === 'ico') return `${stem}.ico`;
    if (format === 'svg') return `${stem}.svg`;
    return `${stem}-${wh}.${format}`;
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
    const blob = await new Promise(resolve => canvas.toBlob(resolve, mimeType, format === 'png' ? undefined : 0.92));
    canvas.width = 0;
    canvas.height = 0;
    return blob;
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
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    canvas.width = 0;
    canvas.height = 0;
    return blob;
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
    { width: 640, height: 1136, name: 'iphone-se' },
    { width: 750, height: 1334, name: 'iphone-8' },
    { width: 828, height: 1792, name: 'iphone-11' },
    { width: 1179, height: 2556, name: 'iphone-14-pro' },
    { width: 1536, height: 2048, name: 'ipad' },
    { width: 2048, height: 2732, name: 'ipad-pro' }
];

const WINDOWS_TILE_SPECS = [
    { width: 70, height: 70 },
    { width: 150, height: 150 },
    { width: 310, height: 310 },
    { width: 310, height: 150 }
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
    const size = 432;
    const foreground = await renderIconBlob(img, size, size, crop, getProcessingOptions({
        paddingPercent: Math.max(parseInt(safePaddingSlider.value, 10) || 0, 18),
        backgroundMode: 'transparent'
    }), 'png');
    addGeneratedFile('android/mipmap-xxxhdpi/ic_launcher_foreground.png', foreground, { width: size, height: size }, 'png', { role: 'android-foreground' });

    const background = await renderBackgroundBlob(size, size);
    addGeneratedFile('android/mipmap-xxxhdpi/ic_launcher_background.png', background, { width: size, height: size }, 'png', { role: 'android-background' });

    const legacy = await renderIconBlob(img, size, size, crop, getProcessingOptions({
        paddingPercent: Math.max(parseInt(safePaddingSlider.value, 10) || 0, 12),
        backgroundMode: backgroundMode.value === 'transparent' ? 'solid' : backgroundMode.value
    }), 'png');
    addGeneratedFile('android/mipmap-xxxhdpi/ic_launcher.png', legacy, { width: size, height: size }, 'png', { role: 'android-legacy' });
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


function hrefFor(name) {
    return `/${name.replace(/\\/g, '/')}`;
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
    manifestMetadataGrid.addEventListener('input', validateManifestMetadata);
    manifestMetadataGrid.addEventListener('change', validateManifestMetadata);
    validateManifestMetadata();
}

function buildManifestSnippet() {
    const icons = generatedFiles
        .filter(file => file.format === 'png' && file.size && file.size.width === file.size.height)
        .filter(file => file.name.startsWith('pwa/') || file.name === 'icon-192.png' || file.name === 'icon-512.png' || [192, 512].includes(file.size.width))
        .map(file => ({
            src: hrefFor(file.name),
            sizes: `${file.size.width}x${file.size.height}`,
            type: 'image/png',
            purpose: file.purpose || (file.name.includes('maskable') ? 'maskable' : 'any')
        }));

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
      <square70x70logo src="/windows/mstile-70x70.png"/>
      <square150x150logo src="/windows/mstile-150x150.png"/>
      <wide310x150logo src="/windows/mstile-310x150.png"/>
      <square310x310logo src="/windows/mstile-310x310.png"/>
      <TileColor>${backgroundColor.value}</TileColor>
    </tile>
  </msapplication>
</browserconfig>`;
}

function normalizedFileName(name) {
    return name.replace(/\\/g, '/');
}

function generatedFileCopyList(prefix = '') {
    if (generatedFiles.length === 0) return '- No generated files yet';
    return generatedFiles
        .map(file => `- ${prefix}${normalizedFileName(file.name)}`)
        .join('\n');
}

function webManifestHref(manifest) {
    if (!manifest) return '';
    return activePresetKey === 'pwa' ? '/pwa/manifest.webmanifest' : '/manifest.webmanifest';
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
    const tabMeta = HANDOFF_SNIPPET_TABS.find(tab => tab.key === activeHandoffSnippetKey) || HANDOFF_SNIPPET_TABS[0];

    handoffTabs.querySelectorAll('[data-handoff-tab]').forEach(tab => {
        const active = tab.dataset.handoffTab === tabMeta.key;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    handoffSnippetTitle.textContent = tabMeta.label;
    handoffSnippet.textContent = snippets[tabMeta.key] || '';
}

function generateSnippets(sizes, formats) {
    const snippetSection = document.getElementById('snippetSection');
    const htmlSnippet = document.getElementById('htmlSnippet');
    const lines = [];
    const icoFile = firstFile(file => file.format === 'ico');
    const svgFile = firstFile(file => file.format === 'svg');
    const appleFile = firstFile(file => file.format === 'png' && file.size?.width === 180 && file.size?.height === 180);
    const manifest = buildManifestSnippet();
    const splashFiles = generatedFiles.filter(file => file.role === 'splash');

    if (icoFile) lines.push(`<link rel="icon" href="${hrefFor(icoFile.name)}" sizes="32x32">`);
    if (svgFile) lines.push(`<link rel="icon" href="${hrefFor(svgFile.name)}" type="image/svg+xml">`);
    if (appleFile) lines.push(`<link rel="apple-touch-icon" href="${hrefFor(appleFile.name)}">`);
    if (manifest) lines.push(`<link rel="manifest" href="${activePresetKey === 'pwa' ? '/pwa/manifest.webmanifest' : '/manifest.webmanifest'}">`);
    for (const splash of splashFiles.slice(0, 6)) {
        lines.push(`<link rel="apple-touch-startup-image" href="${hrefFor(splash.name)}" media="(device-width: ${splash.size.width}px) and (device-height: ${splash.size.height}px)">`);
    }
    if (activePresetKey === 'windows') {
        lines.push(`<meta name="msapplication-config" content="/windows/browserconfig.xml">`);
    }

    const html = lines.join('\n') || '<!-- No applicable tags for selected formats -->';
    generatedSnippets = {
        html,
        manifest,
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
    if (generatedSnippets.extension) support.push(textSupportFile('extension/manifest-icons.json', generatedSnippets.extension, 'application/json'));
    if (generatedSnippets.android) support.push(textSupportFile('android/mipmap-anydpi-v26/ic_launcher.xml', generatedSnippets.android, 'application/xml'));
    if (generatedSnippets.ios) support.push(textSupportFile('ios/AppIcon.appiconset/Contents.json', generatedSnippets.ios, 'application/json'));
    if (generatedSnippets.windows) support.push(textSupportFile('windows/browserconfig.xml', generatedSnippets.windows, 'application/xml'));

    const fileList = generatedFiles.map(file => `- ${file.name} (${formatFileSize(file.blob.size)})`).join('\n');
    support.push(textSupportFile('README.txt', `Icon Forge export\n\nGenerated files:\n${fileList}\n`, 'text/plain'));
    return support;
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
        addValidationCheck(checks, 'pass', label, `${specs.length} expected file${specs.length === 1 ? '' : 's'} present with expected dimensions.`);
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
                specs: [
                    { name: 'android/mipmap-xxxhdpi/ic_launcher_foreground.png', width: 432, height: 432 },
                    { name: 'android/mipmap-xxxhdpi/ic_launcher_background.png', width: 432, height: 432 },
                    { name: 'android/mipmap-xxxhdpi/ic_launcher.png', width: 432, height: 432 }
                ]
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
    return [];
}

function validateSupportFiles(checks) {
    const expected = ['README.txt'];
    if (generatedSnippets.html) expected.push('snippets/head.html');
    if (generatedSnippets.manifest) expected.push(activePresetKey === 'pwa' ? 'pwa/manifest.webmanifest' : 'manifest.webmanifest');
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
    const relevantIcons = generatedFiles
        .filter(file => file.format === 'png' && file.size?.width === file.size?.height)
        .filter(file => file.name.startsWith('pwa/icons/') || file.name === 'icon-192.png' || file.name === 'icon-512.png' || [192, 512].includes(file.size.width));

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
            const expectedSrc = hrefFor(file.name);
            const entry = icons.find(icon => icon.src === expectedSrc);
            if (!entry) {
                mismatches.push(`${file.name} missing`);
                continue;
            }
            const expectedSizes = `${file.size.width}x${file.size.height}`;
            const expectedPurpose = file.purpose || (file.name.includes('maskable') ? 'maskable' : 'any');
            if (entry.sizes !== expectedSizes || entry.type !== 'image/png' || entry.purpose !== expectedPurpose) {
                mismatches.push(`${file.name} metadata mismatch`);
            }
        }
        if (mismatches.length) {
            addValidationCheck(checks, 'fail', 'Manifest icon metadata', fileSpecSummary(mismatches));
        } else {
            addValidationCheck(checks, 'pass', 'Manifest icon metadata', `${relevantIcons.length} generated icon${relevantIcons.length === 1 ? '' : 's'} match manifest src, sizes, type, and purpose.`);
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
        const exportFiles = getExportFiles();
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
        const exportFiles = getExportFiles();
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
        
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const arrayBuffer = await blob.arrayBuffer();
        images.push({
            width: size.width,
            height: size.height,
            data: new Uint8Array(arrayBuffer)
        });
        canvas.width = 0;
        canvas.height = 0;
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
        buildFrameworkHandoffSnippets,
        generateSnippets,
        getSupportFiles,
        buildGenerationDiagnostics,
        getFeatureDiagnostics,
        getSkippedFormatDiagnostics,
        validateGeneratedExport,
        renderExportValidation,
        renderGenerationDiagnostics,
        matchesReplacementTarget,
        getExportFiles,
        setState(next = {}) {
            if (Object.prototype.hasOwnProperty.call(next, 'sourceFileName')) sourceFileName = next.sourceFileName;
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
            if (Object.prototype.hasOwnProperty.call(next, 'manifestMetadata')) {
                const fieldMap = {
                    name: manifestName,
                    shortName: manifestShortName,
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
                for (const [key, value] of Object.entries(next.manifestMetadata || {})) {
                    if (fieldMap[key]) {
                        fieldMap[key].value = Array.isArray(value) ? JSON.stringify(value) : String(value ?? '');
                    }
                }
                validateManifestMetadata();
            }
        },
        getState() {
            return {
                sourceFileName,
                generatedFiles,
                activePresetKey,
                replacementTargetNames: Array.from(replacementTargetNames),
                generatedSnippets,
                featureSupport: { ...featureSupport },
                generationStats: {
                    ...generationStats,
                    fallbackReasons: [...generationStats.fallbackReasons]
                }
            };
        }
    };
}

if ('serviceWorker' in navigator) {
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloadOnControllerChange) {
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
