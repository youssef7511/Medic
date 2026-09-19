import { getTranslations } from 'next-intl/server';
import { CalendarDays, Languages, MapPin, Search, ShieldCheck, Stethoscope } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

async function getPublishedDoctors() {
  try {
    return await prisma.doctorProfile.findMany({
      where: { isPublished: true },
      include: { specialty: true, clinics: { select: { name: true, address: true } } },
      orderBy: { createdAt: 'desc' },
      take: 60,
    });
  } catch {
    return [];
  }
}

function localText(value: unknown, locale: string) {
  const translated = value as Record<string, string> | null;
  return translated?.[locale] ?? translated?.fr ?? '';
}

function clinicCity(address: unknown) {
  const fields = address as Record<string, unknown> | null;
  return typeof fields?.city === 'string' ? fields.city : '';
}

export default async function DoctorsDirectoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; specialty?: string; city?: string }>;
}) {
  const { locale } = await params;
  const filters = await searchParams;
  const t = await getTranslations();
  const ar = locale === 'ar';
  const doctors = await getPublishedDoctors();
  const q = filters.q?.trim().toLocaleLowerCase(locale) ?? '';
  const specialtyFilter = filters.specialty ?? '';
  const cityFilter = filters.city ?? '';

  const specialties = Array.from(
    new Map(doctors.map((doctor) => [doctor.specialty.slug, localText(doctor.specialty.name, locale)])).entries(),
  ).sort((a, b) => a[1].localeCompare(b[1], locale));
  const cities = Array.from(
    new Set(doctors.flatMap((doctor) => doctor.clinics.map((clinic) => clinicCity(clinic.address))).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b, locale));

  const visibleDoctors = doctors.filter((doctor) => {
    const name = localText(doctor.headline, locale);
    const specialty = localText(doctor.specialty.name, locale);
    const doctorCities = doctor.clinics.map((clinic) => clinicCity(clinic.address));
    const searchable = `${name} ${specialty} ${doctor.clinics.map((clinic) => clinic.name).join(' ')} ${doctorCities.join(' ')}`.toLocaleLowerCase(locale);
    return (
      (!q || searchable.includes(q)) &&
      (!specialtyFilter || doctor.specialty.slug === specialtyFilter) &&
      (!cityFilter || doctorCities.includes(cityFilter))
    );
  });
  const featured = visibleDoctors[0];

  return (
    <section className="bg-slate-50 py-10 lg:py-14">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl">
          <p className="medic-kicker">{ar ? 'رعاية أقرب إليك' : 'Des soins plus proches de vous'}</p>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-navy-950 sm:text-4xl">{ar ? 'ابحث عن طبيب' : 'Trouver un médecin'}</h1>
          <p className="mt-3 text-base text-slate-600">{ar ? 'احجز عبر الإنترنت مع مهنيين صحيين موثوقين.' : 'Prenez rendez-vous en ligne avec des professionnels de santé de confiance.'}</p>
        </div>

        <form method="get" className="medic-card mt-8 grid gap-3 p-3 md:grid-cols-[minmax(0,1.6fr)_minmax(180px,0.7fr)_minmax(160px,0.7fr)_auto]">
          <label className="relative">
            <span className="sr-only">{t('common.search')}</span>
            <Search className="absolute start-3 top-3.5 h-5 w-5 text-slate-400" />
            <input name="q" defaultValue={filters.q} placeholder={ar ? 'اسم الطبيب أو التخصص...' : 'Nom du médecin, spécialité...'} className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 ps-11 pe-3 text-sm" />
          </label>
          <select name="specialty" defaultValue={specialtyFilter} aria-label={t('directory.filterSpecialty')} className="h-12 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700">
            <option value="">{t('directory.filterSpecialty')}</option>
            {specialties.map(([slug, name]) => <option key={slug} value={slug}>{name}</option>)}
          </select>
          <select name="city" defaultValue={cityFilter} aria-label={t('directory.filterCity')} className="h-12 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700">
            <option value="">{t('directory.filterCity')}</option>
            {cities.map((city) => <option key={city} value={city}>{city}</option>)}
          </select>
          <button type="submit" className="h-12 rounded-xl bg-brand-600 px-6 text-sm font-semibold text-white hover:bg-brand-700">{t('common.search')}</button>
        </form>

        <div className="mt-8 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div>
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-navy-950">{visibleDoctors.length} {ar ? 'طبيب متاح' : 'médecin(s) disponible(s)'}</p>
              {(q || specialtyFilter || cityFilter) && <Link href="/doctors" className="text-xs font-semibold text-brand-700 hover:underline">{ar ? 'مسح المرشحات' : 'Effacer les filtres'}</Link>}
            </div>

            {visibleDoctors.length === 0 ? (
              <div className="medic-card p-10 text-center">
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-500"><Search className="h-6 w-6" /></span>
                <h2 className="mt-4 font-bold text-navy-950">{t('directory.empty')}</h2>
                <p className="mt-2 text-sm text-slate-500">{ar ? 'جرّب تغيير المدينة أو التخصص.' : 'Essayez une autre ville ou une autre spécialité.'}</p>
              </div>
            ) : (
              <ul className="space-y-4">
                {visibleDoctors.map((doctor) => {
                  const name = localText(doctor.headline, locale);
                  const specialty = localText(doctor.specialty.name, locale);
                  const city = doctor.clinics.map((clinic) => clinicCity(clinic.address)).find(Boolean);
                  return (
                    <li key={doctor.id} className="medic-card p-5 transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lg">
                      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                        <DoctorAvatar name={name || doctor.slug} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <h2 className="text-lg font-bold text-navy-950">{name || doctor.slug}</h2>
                              <p className="mt-1 text-sm font-medium text-brand-700">{specialty}</p>
                            </div>
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{ar ? 'تم التحقق' : 'Profil vérifié'}</span>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-500">
                            {city && <span className="flex items-center gap-1.5"><MapPin className="h-4 w-4" />{doctor.clinics[0]?.name}{city ? ` · ${city}` : ''}</span>}
                            {doctor.languages.length > 0 && <span className="flex items-center gap-1.5"><Languages className="h-4 w-4" />{doctor.languages.join(', ')}</span>}
                          </div>
                          <div className="mt-5 flex flex-wrap gap-3">
                            <Link href={`/doctors/${doctor.slug}`} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-navy-950 hover:border-brand-400 hover:bg-brand-50">{t('directory.viewProfile')}</Link>
                            <Link href={`/login/patient?next=/p/doctors/${doctor.id}/book`} className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">{t('common.book')}</Link>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <aside className="medic-card sticky top-24 hidden overflow-hidden xl:block">
            <div className="border-b border-slate-200 bg-gradient-to-br from-brand-50 to-white p-6">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-white text-brand-700 shadow-sm"><CalendarDays className="h-5 w-5" /></span>
              <h2 className="mt-4 text-lg font-bold text-navy-950">{ar ? 'حجز سريع' : 'Réservation rapide'}</h2>
              <p className="mt-1 text-sm text-slate-500">{ar ? 'اختر طبيبًا واحجز موعدك.' : 'Choisissez un médecin et réservez votre créneau.'}</p>
            </div>
            <div className="p-6">
              {featured ? (
                <>
                  <div className="flex items-center gap-3"><DoctorAvatar name={localText(featured.headline, locale) || featured.slug} small /><div><p className="text-sm font-bold text-navy-950">{localText(featured.headline, locale) || featured.slug}</p><p className="text-xs text-slate-500">{localText(featured.specialty.name, locale)}</p></div></div>
                  <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600"><p className="font-semibold text-navy-950">{ar ? 'مواعيد مرنة' : 'Créneaux flexibles'}</p><p className="mt-1 text-xs leading-5">{ar ? 'التوافر الفعلي يظهر بعد تسجيل الدخول.' : 'Les disponibilités réelles apparaissent après connexion.'}</p></div>
                  <Link href={`/login/patient?next=/p/doctors/${featured.id}/book`} className="mt-5 block rounded-xl bg-brand-600 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-brand-700">{t('common.book')}</Link>
                </>
              ) : <p className="text-sm text-slate-500">{t('directory.empty')}</p>}
              <p className="mt-5 flex items-start gap-2 text-xs leading-5 text-slate-500"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{ar ? 'محترفون تم التحقق منهم للحصول على رعاية موثوقة.' : 'Professionnels vérifiés pour une prise en charge de confiance.'}</p>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}

function DoctorAvatar({ name, small = false }: { name: string; small?: boolean }) {
  return (
    <span className={`${small ? 'h-12 w-12 rounded-xl' : 'h-24 w-24 rounded-2xl'} grid shrink-0 place-items-center bg-gradient-to-br from-brand-100 to-blue-100 text-navy-900`} aria-label={name}>
      <Stethoscope className={small ? 'h-5 w-5' : 'h-7 w-7'} />
    </span>
  );
}
