let crcTable = null;

function table() {
    if (crcTable) return crcTable;
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index++) {
        let value = index;
        for (let bit = 0; bit < 8; bit++) {
            value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
        }
        crcTable[index] = value;
    }
    return crcTable;
}

export function crc32Update(crc, data) {
    const lookup = table();
    for (let index = 0; index < data.length; index++) {
        crc = lookup[(crc ^ data[index]) & 0xFF] ^ (crc >>> 8);
    }
    return crc >>> 0;
}

export function crc32(data) {
    return (crc32Update(0xFFFFFFFF, data) ^ 0xFFFFFFFF) >>> 0;
}

export function createZipLocalHeader(nameBytes, size, crc) {
    const local = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(8, 0, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, size, true);
    view.setUint32(22, size, true);
    view.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    return local;
}

export function createZipCentralEntry(nameBytes, size, crc, offset) {
    const central = new Uint8Array(46 + nameBytes.length);
    const view = new DataView(central.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0x0800, true);
    view.setUint16(10, 0, true);
    view.setUint32(16, crc, true);
    view.setUint32(20, size, true);
    view.setUint32(24, size, true);
    view.setUint16(28, nameBytes.length, true);
    view.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    return central;
}

export function createZipEndRecord(entryCount, centralSize, centralOffset) {
    const end = new Uint8Array(22);
    const view = new DataView(end.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, entryCount, true);
    view.setUint16(10, entryCount, true);
    view.setUint32(12, centralSize, true);
    view.setUint32(16, centralOffset, true);
    return end;
}

export function buildStoredZip(plan) {
    const parts = [];
    const centralEntries = [];
    let offset = 0;

    for (const entry of plan.entries) {
        const { data } = entry.file;
        if (!data || typeof data.length !== 'number') {
            throw new Error(`ZIP entry "${entry.name}" must provide byte data.`);
        }
        const crc = crc32(data);
        const local = createZipLocalHeader(entry.nameBytes, entry.size, crc);
        const central = createZipCentralEntry(entry.nameBytes, entry.size, crc, offset);
        parts.push(local, data);
        centralEntries.push(central);
        offset += local.length + entry.size;
    }

    parts.push(...centralEntries, createZipEndRecord(plan.entries.length, plan.centralSize, offset));
    return new Blob(parts, { type: 'application/zip' });
}
