export const PWA_ICON_SIZES = Object.freeze([72, 96, 128, 144, 152, 192, 384, 512]);
export const PWA_SPLASH_MATRIX_SOURCE = 'https://github.com/elegantapp/pwa-asset-generator/blob/master/src/config/apple-fallback-data.json';
export const PWA_SPLASH_MATRIX_VERIFIED = '2026-07-25';
export const ANDROID_ICON_MATRIX_SOURCE = 'https://developer.android.com/reference/android/graphics/drawable/AdaptiveIconDrawable';
export const ANDROID_ICON_MATRIX_VERIFIED = '2026-07-25';
export const IOS_ICON_MATRIX_SOURCE = 'https://developer.apple.com/library/archive/documentation/Xcode/Reference/xcode_ref-Asset_Catalog_Format/AppIconType.html';
export const IOS_ICON_MATRIX_VERIFIED = '2026-07-25';

export const PLATFORM_MATRIX_METADATA = Object.freeze({
    pwaSplash: Object.freeze({ source: PWA_SPLASH_MATRIX_SOURCE, lastVerified: PWA_SPLASH_MATRIX_VERIFIED }),
    androidIcons: Object.freeze({ source: ANDROID_ICON_MATRIX_SOURCE, lastVerified: ANDROID_ICON_MATRIX_VERIFIED }),
    iosIcons: Object.freeze({ source: IOS_ICON_MATRIX_SOURCE, lastVerified: IOS_ICON_MATRIX_VERIFIED })
});

export const PWA_SPLASH_SPECS = Object.freeze([
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
].map(spec => Object.freeze({
    ...spec,
    source: PWA_SPLASH_MATRIX_SOURCE,
    lastVerified: PWA_SPLASH_MATRIX_VERIFIED
})));

export const WINDOWS_TILE_SPECS = Object.freeze([
    Object.freeze({ width: 70, height: 70 }),
    Object.freeze({ width: 150, height: 150 }),
    Object.freeze({ width: 310, height: 310 }),
    Object.freeze({ width: 310, height: 150 })
]);

export const ANDROID_DENSITY_SPECS = Object.freeze([
    Object.freeze({ density: 'mdpi', adaptive: 108, legacy: 48 }),
    Object.freeze({ density: 'hdpi', adaptive: 162, legacy: 72 }),
    Object.freeze({ density: 'xhdpi', adaptive: 216, legacy: 96 }),
    Object.freeze({ density: 'xxhdpi', adaptive: 324, legacy: 144 }),
    Object.freeze({ density: 'xxxhdpi', adaptive: 432, legacy: 192 })
]);

export const IOS_ICON_SPECS = Object.freeze([
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
].map(spec => Object.freeze(spec)));

export function iosIconFileName(size, scale) {
    return `Icon-App-${size.replace('.', '-')}-${scale}.png`;
}

export function startupImageMediaFor(file) {
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
