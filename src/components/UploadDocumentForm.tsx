'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from '@/i18n/navigation';
import { FileUp, CheckCircle2, Loader2 } from 'lucide-react';
import { MAX_UPLOAD_BYTES } from '@/lib/documents/uploads.validation';

export function UploadDocumentForm({ doctors, locale }: {
  doctors: { linkId: string; name: string }[]; locale: string;
}) {
  const ar = locale === 'ar';
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [sentTo, setSentTo] = useState('');
  const errors: Record<string, string> = {
    file_too_large: ar ? 'الحد الأقصى لحجم الملف هو 10 ميغابايت.' : 'Le fichier doit faire 10 Mo maximum.',
    unsupported_file: ar ? 'اختر ملف PDF أو صورة JPG أو PNG صالحة.' : 'Choisissez un fichier PDF, JPG ou PNG valide.',
    empty_file: ar ? 'اختر ملفًا غير فارغ.' : 'Choisissez un fichier non vide.',
    invalid_title: ar ? 'أدخل عنوانًا من 1 إلى 160 حرفًا.' : 'Saisissez un titre de 1 à 160 caractères.',
    not_found: ar ? 'لم تعد علاقة الرعاية هذه متاحة.' : 'Cette relation de soin n’est plus disponible.',
    unauthorized: ar ? 'يرجى تسجيل الدخول مرة أخرى.' : 'Reconnectez-vous avant d’envoyer le document.',
    storage_unavailable: ar ? 'خدمة المستندات غير متاحة حاليًا.' : 'Le service de documents est indisponible pour le moment.',
  };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get('file');
    setError(''); setSentTo('');
    if (!(file instanceof File) || !file.size) { setError(errors.empty_file!); return; }
    if (file.size > MAX_UPLOAD_BYTES) { setError(errors.file_too_large!); return; }
    setPending(true);
    try {
      const response = await fetch('/api/documents/upload', { method: 'POST', body: data });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setSentTo(doctors.find(doctor => doctor.linkId === data.get('linkId'))?.name ?? '');
      form.reset();
      router.refresh();
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : '';
      setError(errors[code] ?? (ar ? 'تعذر إرسال المستند. يرجى المحاولة مرة أخرى.' : 'L’envoi a échoué. Réessayez.'));
    } finally { setPending(false); }
  }
  return <article className="medic-card mt-6 p-5 sm:p-6">
    <div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-700"><FileUp className="h-5 w-5" /></span><div><h2 className="font-bold">{ar ? 'إرسال مستند إلى طبيبي' : 'Envoyer un document à mon médecin'}</h2><p className="mt-1 text-xs text-slate-500">{ar ? 'تحاليل، تقرير رنين مغناطيسي أو تصوير طبي. PDF أو JPG أو PNG، حتى 10 ميغابايت.' : 'Analyses, compte rendu d’IRM ou imagerie. PDF, JPG ou PNG · 10 Mo maximum.'}</p></div></div>
    {!doctors.length ? <p className="medic-muted mt-4">{ar ? 'احجز موعدًا أولاً للارتباط بطبيب.' : 'Prenez d’abord rendez-vous pour être lié à un médecin.'}</p> : <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2">
      <fieldset disabled={pending} className="contents">
        <label className="medic-label">{ar ? 'الطبيب المستلم' : 'Médecin destinataire'}<select name="linkId" required className="medic-input">{doctors.map(doctor => <option key={doctor.linkId} value={doctor.linkId}>{doctor.name}</option>)}</select></label>
        <label className="medic-label">{ar ? 'نوع المستند' : 'Type de document'}<select name="category" className="medic-input"><option value="LAB_RESULT">{ar ? 'نتائج التحاليل' : 'Résultats d’analyses'}</option><option value="MRI">{ar ? 'تقرير الرنين المغناطيسي' : 'Compte rendu d’IRM'}</option><option value="IMAGING">{ar ? 'تصوير طبي' : 'Imagerie médicale'}</option><option value="OTHER">{ar ? 'مستند طبي آخر' : 'Autre document médical'}</option></select></label>
        <label className="medic-label">{ar ? 'عنوان المستند' : 'Titre du document'}<input name="title" required maxLength={160} placeholder={ar ? 'مثال: تحاليل الدم' : 'Ex. Bilan sanguin du 13 octobre'} className="medic-input" /></label>
        <label className="medic-label">{ar ? 'الملف' : 'Fichier'}<input name="file" type="file" required accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" className="medic-input py-2 file:me-3 file:rounded-md file:border-0 file:bg-sky-50 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-sky-800" /></label>
        <p className="text-xs leading-5 text-slate-500 sm:col-span-2">{ar ? 'المستند متاح لك وللطبيب الذي تختاره.' : 'Le document sera accessible à vous et au médecin sélectionné.'}</p>
        <button type="submit" className="flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60 sm:col-span-2">{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}{pending ? (ar ? 'جارٍ الإرسال…' : 'Envoi en cours…') : (ar ? 'إرسال المستند' : 'Envoyer le document')}</button>
      </fieldset>
    </form>}
    {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {sentTo && <p role="status" className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 className="h-4 w-4 shrink-0" />{ar ? `تم إرسال المستند إلى ${sentTo}.` : `Document envoyé à ${sentTo}.`}</p>}
  </article>;
}
