export const EXPORT_MANIFEST_SCHEMA = 'iconforge-export-v1';
export const EXPORT_MANIFEST_SCHEMA_VERSION = 2;
export const EXPORT_MANIFEST_MIGRATIONS = Object.freeze([
    Object.freeze({
        schemaVersion: 2,
        compatibility: 'additive',
        description: 'Adds schemaVersion, appVersion, and reader compatibility metadata while retaining the legacy version alias.'
    })
]);

export function migrateDraftSchema(draft, currentSchema, legacySchemas) {
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
        return { valid: false, reason: 'Draft data is not an object.' };
    }
    if (draft.schema === currentSchema) {
        return { valid: true, draft, migrated: false };
    }
    if (legacySchemas.includes(draft.schema)) {
        return {
            valid: true,
            draft: { ...draft, schema: currentSchema, migratedFrom: draft.schema },
            migrated: true
        };
    }
    return { valid: false, reason: `Unsupported draft schema "${draft.schema || 'missing'}".` };
}

export function inspectExportManifest(input) {
    let manifest;
    try {
        manifest = typeof input === 'string' ? JSON.parse(input) : input;
    } catch {
        return {
            valid: false,
            code: 'EXPORT_MANIFEST_INVALID_JSON',
            message: 'Export manifest must be valid JSON.',
            manifest: null,
            migrated: false
        };
    }
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        return {
            valid: false,
            code: 'EXPORT_MANIFEST_INVALID',
            message: 'Export manifest must be a JSON object.',
            manifest: null,
            migrated: false
        };
    }
    if (manifest.schema === EXPORT_MANIFEST_SCHEMA && manifest.schemaVersion === undefined) {
        return {
            valid: true,
            code: 'EXPORT_MANIFEST_MIGRATED_V1',
            message: 'Legacy export manifest v1 was migrated in memory.',
            manifest: {
                ...manifest,
                schema: EXPORT_MANIFEST_SCHEMA,
                schemaVersion: 1,
                appVersion: manifest.version || null
            },
            migrated: true
        };
    }
    if (manifest.schema !== EXPORT_MANIFEST_SCHEMA || !Number.isInteger(manifest.schemaVersion)) {
        return {
            valid: false,
            code: 'EXPORT_SCHEMA_UNKNOWN',
            message: `Expected ${EXPORT_MANIFEST_SCHEMA} with an integer schemaVersion.`,
            manifest: null,
            migrated: false
        };
    }
    if (manifest.schemaVersion > EXPORT_MANIFEST_SCHEMA_VERSION) {
        return {
            valid: false,
            code: 'EXPORT_SCHEMA_UNSUPPORTED',
            message: `Export manifest schema version ${manifest.schemaVersion} is newer than supported version ${EXPORT_MANIFEST_SCHEMA_VERSION}.`,
            manifest: null,
            migrated: false
        };
    }
    if (manifest.schemaVersion < 1) {
        return {
            valid: false,
            code: 'EXPORT_SCHEMA_UNSUPPORTED',
            message: `Export manifest schema version ${manifest.schemaVersion} is not supported.`,
            manifest: null,
            migrated: false
        };
    }
    return {
        valid: true,
        code: 'EXPORT_MANIFEST_VALID',
        message: '',
        manifest,
        migrated: false
    };
}
