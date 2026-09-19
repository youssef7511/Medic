import { redirect } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  FileText,
  HeartPulse,
  MessageSquare,
  Plus,
  Stethoscope,
  Users,
} from 'lucide-react';
import { getCurrentActor } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/config';
import { getPatientAppointments } from '@/lib/booking/queries';
import { AppointmentStatusBadge } from '@/components/AppointmentStatusBadge';

export const dynamic = 'force-dynamic';

export default async function PatientHubPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const ar = locale === 'ar';
  const actor = await getCurrentActor();
  if (!actor) redirect(`/${locale}/login`);

  const [profile, appointments] = await Promise.all([
    prisma.patientProfile.findUnique({
      where: { userId: actor.userId },
      select: {
        firstName: true,
        allergiesEnc: true,
        allergiesAffirmedNone: true,
        links: {
          where: { status: 'ACTIVE' },
          select: {
            doctor: { select: { id: true, headline: true, specialty: { select: { name: true } } } },
            _count: { select: { documents: true, threads: true } },
          },
        },
      },
    }),
    getPatientAppointments(actor.userId, locale),
  ]);

  const doctors = profile?.links ?? [];
  const upcoming = appointments
    .filter((item) => !item.isPast && !['CANCELLED', 'COMPLETED', 'NO_SHOW'].includes(item.status))
    .sort((a, b) => a.startAtIso.localeCompare(b.startAtIso))[0];
  const documentCount = doctors.reduce((sum, link) => sum + link._count.documents, 0);
  const firstDoctor = doctors[0]?.doctor;

  return (
    <section>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="medic-kicker">{ar ? 'مساحة المريض' : 'Espace patient'}</p>
          <h1 className="medic-page-title mt-2">{ar ? `مرحباً، ${profile?.firstName ?? ''}` : `Bonjour, ${profile?.firstName ?? ''}`}</h1>
          <p className="mt-2 text-sm text-slate-500">{ar ? 'اعتنِ بصحتك اليوم، وفريقك معك.' : 'Prenez soin de vous aujourd’hui. Votre équipe reste à vos côtés.'}</p>
        </div>
        <Link href="/doctors" className="inline-flex items-center justify-center gap-2 self-start rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 sm:self-auto">
          <Plus className="h-4 w-4" />{ar ? 'حجز موعد' : 'Prendre rendez-vous'}
        </Link>
      </div>

      <div className="mt-7 grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.75fr)]">
        <div className="space-y-5">
          <div className="grid gap-5 lg:grid-cols-2">
            <article className="medic-card overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <h2 className="flex items-center gap-2 text-base font-bold text-navy-950"><CalendarDays className="h-5 w-5 text-brand-600" />{ar ? 'الموعد القادم' : 'Prochain rendez-vous'}</h2>
                <Link href="/p/appointments" className="text-xs font-semibold text-brand-700 hover:underline">{ar ? 'عرض الكل' : 'Voir tout'}</Link>
              </div>
              {upcoming ? (
                <div className="p-5">
                  <div className="flex items-start gap-4">
                    <Avatar icon={Stethoscope} />
                    <div className="min-w-0 flex-1"><p className="font-bold text-navy-950">{upcoming.counterpartyName}</p><p className="mt-1 text-sm text-slate-500">{upcoming.clinicName}</p><div className="mt-3"><AppointmentStatusBadge status={upcoming.status} locale={locale} /></div></div>
                  </div>
                  <div className="mt-5 rounded-xl bg-slate-50 p-4"><p className="text-sm font-semibold capitalize text-navy-950">{upcoming.whenLabel}</p><p className="mt-1 text-xs text-slate-500">{ar ? 'ستتلقى تذكيراً قبل الموعد.' : 'Vous recevrez un rappel avant le rendez-vous.'}</p></div>
                  <Link href="/p/appointments" className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-navy-950 hover:border-brand-400 hover:bg-brand-50">{ar ? 'عرض التفاصيل' : 'Voir les détails'}<ArrowRight className="h-4 w-4 rtl:rotate-180" /></Link>
                </div>
              ) : (
                <div className="p-6 text-center"><Avatar icon={CalendarDays} centered /><p className="mt-4 text-sm font-semibold text-navy-950">{ar ? 'لا يوجد موعد قادم' : 'Aucun rendez-vous à venir'}</p><Link href="/doctors" className="mt-2 inline-block text-sm font-semibold text-brand-700 hover:underline">{ar ? 'ابحث عن طبيب' : 'Trouver un médecin'}</Link></div>
              )}
            </article>

            <article className="medic-card overflow-hidden">
              <div className="border-b border-slate-100 px-5 py-4"><h2 className="text-base font-bold text-navy-950">{ar ? 'إجراءات سريعة' : 'Actions rapides'}</h2></div>
              <div className="divide-y divide-slate-100 px-5">
                <QuickAction href="/doctors" icon={CalendarDays} title={ar ? 'حجز موعد' : 'Prendre rendez-vous'} text={ar ? 'ابحث عن طبيب واختر موعدًا.' : 'Trouvez un médecin et choisissez un créneau.'} />
                <QuickAction href="/p/appointments" icon={FileText} title={ar ? 'مواعيدي' : 'Mes rendez-vous'} text={ar ? 'راجع طلباتك وتأكيداتك.' : 'Consultez vos demandes et confirmations.'} />
                {firstDoctor && <QuickAction href={`/p/doctors/${firstDoctor.id}/messages`} icon={MessageSquare} title={ar ? 'الرسائل' : 'Messages'} text={ar ? 'تواصل بأمان مع فريق الرعاية.' : 'Échangez en sécurité avec votre équipe.'} />}
              </div>
            </article>
          </div>

          <article className="medic-card overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="flex items-center gap-2 text-base font-bold text-navy-950"><Users className="h-5 w-5 text-brand-600" />{ar ? 'فريق الرعاية الخاص بي' : 'Mon équipe de soin'}</h2>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{doctors.length}</span>
            </div>
            {doctors.length === 0 ? (
              <div className="p-8 text-center"><p className="text-sm text-slate-500">{ar ? 'لا يوجد أطباء مرتبطون بعد.' : 'Aucun médecin lié pour le moment.'}</p><Link href="/doctors" className="mt-3 inline-block text-sm font-semibold text-brand-700 hover:underline">{ar ? 'اكتشف الأطباء' : 'Découvrir les médecins'}</Link></div>
            ) : (
              <ul className="grid gap-4 p-5 md:grid-cols-2">
                {doctors.map(({ doctor, _count }) => {
                  const name = (doctor.headline as Record<Locale, string>)?.[locale as Locale] ?? '';
                  const specialty = (doctor.specialty.name as Record<Locale, string>)?.[locale as Locale] ?? '';
                  return (
                    <li key={doctor.id} className="rounded-2xl border border-slate-200 p-4">
                      <div className="flex items-center gap-3"><Avatar icon={Stethoscope} /><div className="min-w-0"><p className="truncate text-sm font-bold text-navy-950">{name}</p><p className="truncate text-xs text-slate-500">{specialty}</p></div></div>
                      <div className="mt-4 flex flex-wrap gap-2"><Link href={`/p/doctors/${doctor.id}/book`} className="rounded-lg bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-800 hover:bg-brand-100">{ar ? 'حجز' : 'Réserver'}</Link><Link href={`/p/doctors/${doctor.id}/messages`} className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200">{ar ? 'رسالة' : 'Message'}</Link><Link href={`/p/doctors/${doctor.id}/documents`} className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200">{ar ? 'الوثائق' : `Documents (${_count.documents})`}</Link></div>
                    </li>
                  );
                })}
              </ul>
            )}
          </article>
        </div>

        <aside className="space-y-5">
          <article className="medic-card p-5">
            <div className="flex items-center justify-between"><h2 className="flex items-center gap-2 font-bold text-navy-950"><AlertTriangle className="h-5 w-5 text-amber-500" />{ar ? 'الحساسيات' : 'Allergies'}</h2><Link href="/p/allergies" className="text-xs font-semibold text-brand-700 hover:underline">{ar ? 'تعديل' : 'Modifier'}</Link></div>
            <div className={`mt-4 rounded-xl p-4 ${profile?.allergiesEnc ? 'bg-amber-50' : profile?.allergiesAffirmedNone ? 'bg-emerald-50' : 'bg-slate-50'}`}>
              <p className="text-sm font-semibold text-navy-950">{profile?.allergiesEnc ? (ar ? 'تم تسجيل الحساسية' : 'Allergies renseignées') : profile?.allergiesAffirmedNone ? (ar ? 'لا توجد حساسية معروفة' : 'Aucune allergie connue') : (ar ? 'معلومات غير مكتملة' : 'Information à compléter')}</p>
              <p className="mt-2 text-xs leading-5 text-slate-600">{ar ? 'تظهر هذه المعلومات للطبيب عند وصف الدواء.' : 'Cette information est présentée au médecin lors de la prescription.'}</p>
            </div>
          </article>

          <article className="medic-card p-5">
            <h2 className="flex items-center gap-2 font-bold text-navy-950"><HeartPulse className="h-5 w-5 text-brand-600" />{ar ? 'ملفي الصحي' : 'Mon dossier de santé'}</h2>
            <div className="mt-4 grid grid-cols-2 gap-3"><SmallMetric value={String(doctors.length)} label={ar ? 'أطباء' : 'Médecins'} /><SmallMetric value={String(documentCount)} label={ar ? 'وثائق' : 'Documents'} /></div>
            {firstDoctor && <Link href={`/p/doctors/${firstDoctor.id}/documents`} className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-navy-950 hover:bg-slate-50"><FileText className="h-4 w-4" />{ar ? 'عرض الوثائق' : 'Voir les documents'}</Link>}
          </article>
        </aside>
      </div>
    </section>
  );
}

function Avatar({ icon: Icon, centered = false }: { icon: typeof Stethoscope; centered?: boolean }) {
  return <span className={`${centered ? 'mx-auto' : ''} grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-700`}><Icon className="h-5 w-5" /></span>;
}

function QuickAction({ href, icon: Icon, title, text }: { href: string; icon: typeof CalendarDays; title: string; text: string }) {
  return <Link href={href} className="group flex items-center gap-4 py-4"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700"><Icon className="h-5 w-5" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-navy-950">{title}</span><span className="mt-0.5 block text-xs leading-5 text-slate-500">{text}</span></span><ArrowRight className="h-4 w-4 text-slate-300 transition group-hover:text-brand-600 rtl:rotate-180" /></Link>;
}

function SmallMetric({ value, label }: { value: string; label: string }) {
  return <div className="rounded-xl bg-slate-50 p-4 text-center"><p className="text-2xl font-bold text-navy-950">{value}</p><p className="mt-1 text-xs text-slate-500">{label}</p></div>;
}
