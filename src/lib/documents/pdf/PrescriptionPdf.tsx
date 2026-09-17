import { join } from 'node:path';
import { Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer';
import type { MedicationLine } from '@/lib/documents/prescriptions.validation';

/**
 * Prescription PDF template (§8). Bilingual: Latin for fr, an embedded Arabic
 * face for ar with RTL. React-PDF renders server-side with no browser binary,
 * keeping the app host-agnostic (§10).
 *
 * Fonts are read from the source tree at render time. This works in `next dev`,
 * `next start`, and the tsx test/e2e runners because the process runs from the
 * project root with `src/` present. A fully bundled standalone build would need
 * these copied into the output — noted as a deployment follow-up.
 */
const FONT_DIR = join(process.cwd(), 'src/lib/documents/pdf/fonts');

let registered = false;
function ensureFonts() {
  if (registered) return;
  // Static TTFs, not variable — react-pdf's fontkit fails to shape Arabic from a
  // variable font (the render crashes deep in glyph layout).
  Font.register({ family: 'NotoSans', src: join(FONT_DIR, 'NotoSans-Static.ttf') });
  Font.register({ family: 'NotoSansArabic', src: join(FONT_DIR, 'NotoSansArabic-Static.ttf') });
  // React-PDF hyphenates by default, which mangles medical terms and Arabic.
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}

export interface PrescriptionPdfProps {
  locale: 'fr' | 'ar';
  doctorName: string;
  licenseNumber: string;
  clinicName: string;
  patientName: string;
  patientDob: string; // pre-formatted
  medications: MedicationLine[];
  notes?: string;
  issuedAt: string; // pre-formatted
}

const T = {
  fr: {
    title: 'Ordonnance',
    license: 'N° de licence',
    clinic: 'Cabinet',
    patient: 'Patient',
    dob: 'Né(e) le',
    drug: 'Médicament',
    dose: 'Posologie',
    frequency: 'Fréquence',
    duration: 'Durée',
    instructions: 'Instructions',
    days: 'jours',
    notes: 'Notes',
    issued: 'Délivrée le',
    signature: 'Signature',
  },
  ar: {
    title: 'وصفة طبية',
    license: 'رقم الترخيص',
    clinic: 'العيادة',
    patient: 'المريض',
    dob: 'تاريخ الميلاد',
    drug: 'الدواء',
    dose: 'الجرعة',
    frequency: 'التواتر',
    duration: 'المدة',
    instructions: 'التعليمات',
    days: 'يوم',
    notes: 'ملاحظات',
    issued: 'صدرت في',
    signature: 'التوقيع',
  },
} as const;

export function PrescriptionPdf(props: PrescriptionPdfProps) {
  ensureFonts();
  const ar = props.locale === 'ar';
  const t = T[props.locale];
  const font = ar ? 'NotoSansArabic' : 'NotoSans';
  const align = ar ? 'right' : 'left';
  const direction: 'rtl' | 'ltr' = ar ? 'rtl' : 'ltr';

  const styles = StyleSheet.create({
    page: { fontFamily: font, fontSize: 11, padding: 40, color: '#111827', direction },
    header: { borderBottomWidth: 2, borderBottomColor: '#1f63d6', paddingBottom: 10, marginBottom: 16 },
    title: { fontSize: 20, color: '#1a4fac', textAlign: align },
    doctor: { fontSize: 13, marginTop: 4, textAlign: align },
    meta: { fontSize: 10, color: '#6b7280', textAlign: align },
    section: { marginBottom: 12 },
    label: { fontSize: 9, color: '#6b7280', textAlign: align },
    value: { fontSize: 12, textAlign: align },
    medRow: { borderBottomWidth: 1, borderBottomColor: '#e5e7eb', paddingVertical: 6 },
    medDrug: { fontSize: 12, textAlign: align },
    medDetail: { fontSize: 10, color: '#374151', textAlign: align },
    notes: { fontSize: 11, textAlign: align, marginTop: 4 },
    footer: {
      marginTop: 30,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: '#e5e7eb',
      flexDirection: ar ? 'row-reverse' : 'row',
      justifyContent: 'space-between',
    },
  });

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>{t.title}</Text>
          <Text style={styles.doctor}>{props.doctorName}</Text>
          <Text style={styles.meta}>
            {t.license}: {props.licenseNumber} · {t.clinic}: {props.clinicName}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>{t.patient}</Text>
          <Text style={styles.value}>{props.patientName}</Text>
          <Text style={styles.meta}>
            {t.dob}: {props.patientDob}
          </Text>
        </View>

        <View style={styles.section}>
          {props.medications.map((m, i) => (
            <View key={i} style={styles.medRow}>
              <Text style={styles.medDrug}>
                {m.drug} — {m.dose}
              </Text>
              <Text style={styles.medDetail}>
                {[
                  m.frequency,
                  m.durationDays ? `${m.durationDays} ${t.days}` : null,
                  m.instructions,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
          ))}
        </View>

        {props.notes ? (
          <View style={styles.section}>
            <Text style={styles.label}>{t.notes}</Text>
            <Text style={styles.notes}>{props.notes}</Text>
          </View>
        ) : null}

        <View style={styles.footer}>
          <Text style={styles.meta}>
            {t.issued}: {props.issuedAt}
          </Text>
          <Text style={styles.meta}>{t.signature}: ________________</Text>
        </View>
      </Page>
    </Document>
  );
}
