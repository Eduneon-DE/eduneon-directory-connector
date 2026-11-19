export const APPLICATION_NAME = "Eduneon Directory Connector";

/** Eduneon cloud used when no custom server URL is configured. */
export const DEFAULT_SERVER_URL = "https://app.eduneon.com";
export const DEFAULT_API_URL = DEFAULT_SERVER_URL + "/api";
export const DEFAULT_IDENTITY_URL = DEFAULT_SERVER_URL + "/identity";

/**
 * Maximum UTF-8 byte length for a secret value stored via Windows Credential Manager.
 *
 * Mirrors MAX_CREDENTIAL_BLOB_SIZE (5 * 512 = 2560 bytes) in native/src/encoding.rs, minus the
 * 2-byte V1 blob header (VERSION_MARKER + V1_HEADER) that BlobVersion::encode prepends before
 * the UTF-8 payload. Windows-only: macOS Keychain and Linux secret storage have no equivalent
 * limit.
 */
export const MAX_WINDOWS_CREDENTIAL_SECRET_BYTES = 5 * 512 - 2; // 2558
