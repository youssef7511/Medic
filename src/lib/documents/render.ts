import { createHash } from 'node:crypto';
import { renderToBuffer } from '@react-pdf/renderer';
import { PrescriptionPdf, type PrescriptionPdfProps } from './pdf/PrescriptionPdf';

export interface RenderedDocument {
  bytes: Uint8Array<ArrayBuffer>;
  /** sha256 hex of the bytes — the integrity anchor stored on the Document. */
  checksum: string;
  byteSize: number;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Renders a prescription to an immutable PDF + its checksum.
 *
 * The checksum is deterministic for identical input, so a later download can
 * verify the stored bytes were not tampered with. Returns a Uint8Array backed
 * by its own ArrayBuffer (Prisma `Bytes` / ObjectStore both want that, not
 * Node's Buffer<ArrayBufferLike>).
 */
export async function renderPrescriptionPdf(
  props: PrescriptionPdfProps,
): Promise<RenderedDocument> {
  const buffer = await renderToBuffer(PrescriptionPdf(props));
  const bytes = new Uint8Array(new ArrayBuffer(buffer.length));
  bytes.set(buffer);
  return { bytes, checksum: sha256Hex(bytes), byteSize: bytes.length };
}
