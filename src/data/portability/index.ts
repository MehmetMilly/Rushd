/**
 * P04-C offline portability: versioned export, validated staged import,
 * scoped reset, and round-trip identity. No network or account client.
 */

export {
  PORTABLE_FORMAT,
  PORTABLE_FORMAT_VERSION,
  MAX_PORTABLE_BYTES,
  REPLACE_ACTIVE_CONFIRMATION,
  RESET_SCOPE_CONFIRMATION,
  portableDocumentDigest,
  type PortableDocument,
} from './format';
export { parsePortableDocument, type PortablePreview, type PortableValidation } from './validate';
export { decodePortableSnapshot, decodePortableCheckpoints } from './decode';
export {
  exportActiveSnapshot,
  previewPortableImport,
  importPortableReplacement,
  resetGuestScope,
  ACTIVATION_COMMIT_POINT,
} from './snapshot';
