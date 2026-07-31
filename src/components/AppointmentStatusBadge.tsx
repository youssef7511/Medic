const STYLES: Record<string, string> = {
  REQUESTED: 'bg-amber-50 text-amber-800 border-amber-200',
  CONFIRMED: 'bg-green-50 text-green-800 border-green-200',
  CANCELLED: 'bg-gray-100 text-gray-600 border-gray-200',
  COMPLETED: 'bg-blue-50 text-blue-800 border-blue-200',
  NO_SHOW: 'bg-red-50 text-red-800 border-red-200',
};

const LABELS: Record<string, { fr: string; ar: string }> = {
  REQUESTED: { fr: 'En attente', ar: 'قيد الانتظار' },
  CONFIRMED: { fr: 'Confirmé', ar: 'مؤكَّد' },
  CANCELLED: { fr: 'Annulé', ar: 'ملغى' },
  COMPLETED: { fr: 'Terminé', ar: 'منتهٍ' },
  NO_SHOW: { fr: 'Absent', ar: 'لم يحضر' },
};

export function AppointmentStatusBadge({ status, locale }: { status: string; locale: string }) {
  const style = STYLES[status] ?? STYLES.CANCELLED;
  const label = LABELS[status];
  const text = locale === 'ar' ? label?.ar : label?.fr;

  return (
    <span className={`rounded border px-2 py-0.5 text-xs font-medium ${style}`}>
      {text ?? status}
    </span>
  );
}
