import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { prisma } from '@/lib/db';
import { getCurrentActor } from '@/lib/auth/session';
import type { Locale } from '@/i18n/config';
import { ArrowRight, Languages, MapPin, ShieldCheck, Stethoscope } from 'lucide-react';

export const dynamic = 'force-dynamic';

async function getDoctor(slug: string) {
  try {
    return await prisma.doctorProfile.findFirst({
      where: { slug, isPublished: true },
      include: { specialty: true, clinics: true },
    });
  } catch {
    return null;
  }
}

// §4: profiles are SSR + indexable. Real per-doctor metadata drives SEO.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; locale: string }>;
}): Promise<Metadata> {
  const { slug, locale } = await params;
  const doctor = await getDoctor(slug);
  if (!doctor) return {};
  const headline = (doctor.headline as Record<Locale, string>)?.[locale as Locale] ?? doctor.slug;
  return { title: `${headline} — Medic`, description: headline };
}

export default async function DoctorProfilePage({
  params,
}: {
  params: Promise<{ slug: string; locale: string }>;
}) {
  const { slug, locale } = await params;
  const t = await getTranslations();
  const doctor = await getDoctor(slug);
  if (!doctor) notFound();

  const headline = (doctor.headline as Record<Locale, string>)?.[locale as Locale] ?? doctor.slug;
  const bio = (doctor.bio as Record<Locale, string>)?.[locale as Locale] ?? '';
  const specialty = (doctor.specialty.name as Record<Locale, string>)?.[locale as Locale] ?? '';

  const actor = await getCurrentActor();
  const bookPath = `/p/doctors/${doctor.id}/book`;
  const ar = locale === 'ar';

  return (
    <article className="bg-slate-50 py-10 lg:py-14">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <Link href="/doctors" className="text-sm font-semibold text-brand-700 hover:underline">← {ar ? 'جميع الأطباء' : 'Tous les médecins'}</Link>
        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="medic-card overflow-hidden">
            <div className="bg-gradient-to-br from-brand-50 via-white to-blue-50 p-6 sm:p-8">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                <span className="grid h-24 w-24 shrink-0 place-items-center rounded-3xl bg-white text-brand-700 shadow-card"><Stethoscope className="h-9 w-9" /></span>
                <div>
                  <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-brand-700">{specialty}</p><span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700"><ShieldCheck className="h-3.5 w-3.5" />{ar ? 'تم التحقق' : 'Vérifié'}</span></div>
                  <h1 className="mt-2 text-3xl font-bold tracking-tight text-navy-950">{headline}</h1>
                  {doctor.languages.length > 0 && <p className="mt-3 flex items-center gap-2 text-sm text-slate-500"><Languages className="h-4 w-4" />{doctor.languages.join(', ')}</p>}
                </div>
              </div>
            </div>
            <div className="p-6 sm:p-8">
              <h2 className="text-lg font-bold text-navy-950">{ar ? 'عن الطبيب' : 'À propos'}</h2>
              <p className="mt-3 max-w-3xl whitespace-pre-line text-sm leading-7 text-slate-600">{bio || (ar ? 'لم تتم إضافة سيرة ذاتية بعد.' : 'Aucune biographie renseignée pour le moment.')}</p>
              {doctor.clinics.length > 0 && <div className="mt-8"><h2 className="text-lg font-bold text-navy-950">{ar ? 'أماكن الاستشارة' : 'Lieux de consultation'}</h2><div className="mt-3 grid gap-3 sm:grid-cols-2">{doctor.clinics.map((clinic) => { const address = clinic.address as Record<string, string>; return <div key={clinic.id} className="rounded-2xl border border-slate-200 p-4"><MapPin className="h-5 w-5 text-brand-600" /><p className="mt-3 text-sm font-semibold text-navy-950">{clinic.name}</p><p className="mt-1 text-xs leading-5 text-slate-500">{[address.line1, address.city, address.country].filter(Boolean).join(', ')}</p></div>; })}</div></div>}
            </div>
          </div>

          <aside className="medic-card sticky top-24 overflow-hidden">
            <div className="border-b border-slate-100 bg-navy-950 p-6 text-white"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-300">{ar ? 'الحجز عبر الإنترنت' : 'Réservation en ligne'}</p><h2 className="mt-3 text-xl font-bold">{ar ? 'اختر موعدك' : 'Choisissez votre créneau'}</h2><p className="mt-2 text-sm leading-6 text-slate-300">{ar ? 'اعرض التوفر الحقيقي للطبيب وأرسل طلبك.' : 'Consultez les disponibilités réelles du médecin et envoyez votre demande.'}</p></div>
            <div className="p-6"><div className="rounded-xl bg-slate-50 p-4"><p className="text-sm font-semibold text-navy-950">{ar ? 'طلب آمن' : 'Demande sécurisée'}</p><p className="mt-1 text-xs leading-5 text-slate-500">{ar ? 'سيتم تأكيد الموعد من قبل الطبيب.' : 'Le rendez-vous sera confirmé par le médecin.'}</p></div><Link href={actor ? bookPath : `/login?next=${bookPath}`} className="mt-5 flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white hover:bg-brand-700">{t('common.book')}<ArrowRight className="h-4 w-4 rtl:rotate-180" /></Link></div>
          </aside>
        </div>
      </div>
    </article>
  );
}
