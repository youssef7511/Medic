import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { renderPrescriptionPdf } from './render';
import type { PrescriptionPdfProps } from './pdf/PrescriptionPdf';

const base: PrescriptionPdfProps = {
  locale: 'fr',
  doctorName: 'Dr Amine Benali',
  licenseNumber: 'TN-2019-4471',
  clinicName: 'Cabinet Centre-Ville',
  patientName: 'Amina Trabelsi',
  patientDob: '05/05/1990',
  medications: [
    { drug: 'Amoxicilline', dose: '500 mg', frequency: '3×/jour', durationDays: 7 },
  ],
  issuedAt: '20/07/2026',
};

function isPdf(bytes: Uint8Array): boolean {
  // "%PDF" magic number.
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

test('renders a French prescription to a real PDF', async () => {
  const out = await renderPrescriptionPdf(base);
  assert.ok(isPdf(out.bytes), 'must start with %PDF');
  assert.ok(out.byteSize > 1000, `expected a real document, got ${out.byteSize} bytes`);
  assert.equal(out.checksum.length, 64);
});

test('renders an Arabic (RTL) prescription', async () => {
  const out = await renderPrescriptionPdf({
    ...base,
    locale: 'ar',
    doctorName: 'د. أمين بن علي',
    patientName: 'أمينة الطرابلسي',
    medications: [{ drug: 'أموكسيسيلين', dose: '500 ملغ', frequency: '3 مرات يوميًا', durationDays: 7 }],
  });
  assert.ok(isPdf(out.bytes));
  assert.ok(out.byteSize > 1000);
});

test('the returned checksum matches a sha256 of the returned bytes', async () => {
  // This is the property the download path relies on: store these bytes + this
  // checksum, then on read recompute over the fetched bytes and compare. (PDFs
  // are NOT byte-deterministic across renders — react-pdf embeds a unique doc
  // id — so checksum equality is an integrity anchor, not a reproducibility one.)
  const out = await renderPrescriptionPdf(base);
  const recomputed = createHash('sha256').update(out.bytes).digest('hex');
  assert.equal(out.checksum, recomputed);
  assert.equal(out.byteSize, out.bytes.length);
});
