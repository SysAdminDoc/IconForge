export function buildManifestDocument(metadata, icons) {
    if (!metadata || !Array.isArray(icons) || icons.length === 0) return null;
    return { ...metadata, icons };
}

export function buildAndroidAdaptiveIconDocument({ themed = false } = {}) {
    const monochrome = themed
        ? '\n    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />'
        : '';
    return `<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />${monochrome}
</adaptive-icon>`;
}

export function buildAndroidManifestDocument() {
    return `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application
        android:icon="@mipmap/ic_launcher"
        android:roundIcon="@mipmap/ic_launcher_round" />
</manifest>`;
}

export function buildWindowsBrowserConfigDocument(tileColor, paths = {}) {
    const {
        square70 = 'mstile-70x70.png',
        square150 = 'mstile-150x150.png',
        wide310 = 'mstile-310x150.png',
        square310 = 'mstile-310x310.png'
    } = paths;
    return `<?xml version="1.0" encoding="utf-8"?>
<browserconfig>
    <msapplication>
        <tile>
            <square70x70logo src="${square70}"/>
            <square150x150logo src="${square150}"/>
            <wide310x150logo src="${wide310}"/>
            <square310x310logo src="${square310}"/>
            <TileColor>${tileColor}</TileColor>
        </tile>
    </msapplication>
</browserconfig>`;
}
