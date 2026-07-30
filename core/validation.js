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

export function inspectArtifactBytes(file, bytes) {
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
