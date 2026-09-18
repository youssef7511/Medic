export const BREAK_GLASS_NOTIFICATION_TOPIC = 'security.break_glass_activated';

export function renderBreakGlassSms(locale: string): string {
  if (locale === 'ar') {
    return 'تم تفعيل وصول إداري طارئ ومؤقت إلى ملفك الطبي. إذا لم تتوقع ذلك، فاتصل بدعم Medic فورًا.';
  }
  return 'Un accès administratif d’urgence et temporaire à votre dossier médical a été activé. Si cela est inattendu, contactez immédiatement le support Medic.';
}
