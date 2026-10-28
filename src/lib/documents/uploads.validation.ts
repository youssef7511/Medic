export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const UPLOAD_CATEGORIES = ['LAB_RESULT', 'MRI', 'IMAGING', 'OTHER'] as const;
export type UploadCategory = (typeof UPLOAD_CATEGORIES)[number];
export interface UploadMetadata { title: string; category: UploadCategory; originalName: string }

export class UploadValidationError extends Error {
  constructor(public code: string) { super(code); this.name = 'UploadValidationError'; }
}

/** Check actual file signatures, never trust a browser-supplied MIME type. */
export function validateUpload(bytes: Uint8Array, declaredType: string, metadata: {
  title: string; category: string; originalName: string;
}): { contentType: string; metadata: UploadMetadata } {
  if (!bytes.length) throw new UploadValidationError('empty_file');
  if (bytes.length > MAX_UPLOAD_BYTES) throw new UploadValidationError('file_too_large');
  const matches = (signature: number[]) => signature.every((value, index) => bytes[index] === value);
  let contentType: string;
  if (matches([0x25, 0x50, 0x44, 0x46, 0x2d]) && new TextDecoder().decode(bytes.slice(-2048)).includes('%%EOF')) contentType = 'application/pdf';
  else if (matches([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) && bytes.length >= 33) contentType = 'image/png';
  else if (matches([0xff, 0xd8, 0xff]) && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9) contentType = 'image/jpeg';
  else throw new UploadValidationError('unsupported_file');
  if (declaredType && declaredType !== contentType) throw new UploadValidationError('unsupported_file');
  if (!(UPLOAD_CATEGORIES as readonly string[]).includes(metadata.category)) throw new UploadValidationError('invalid_category');
  const title = metadata.title.trim();
  if (!title || title.length > 160 || /[\x00-\x1f]/.test(title)) throw new UploadValidationError('invalid_title');
  const originalName = metadata.originalName.split(/[\\/]/).at(-1)?.replace(/[\x00-\x1f]/g, '').slice(0, 200) || 'document';
  return { contentType, metadata: { title, category: metadata.category as UploadCategory, originalName } };
}
