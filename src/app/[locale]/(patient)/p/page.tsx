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
import { listPatientThreads } from '@/lib/messaging/threads';
import { PatientThreads } from '@/components/PatientThreads';
import { listDocuments } from '@/lib/documents/prescriptions';
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
            id: true,
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
  const [threads, documentGroups] = await Promise.all([
    profile ? listPatientThreads(actor, locale) : Promise.resolve([]),
    Promise.all(doctors.map(link => listDocuments(actor, link.id, locale))),
  ]);
  const recentDocuments = documentGroups.flat().sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime()).slice(0, 3);
  const doctorIds = Object.fromEntries(doctors.map(link => [link.id, link.doctor.id]));

  return (
    <section>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="medic-kicker">{ar ? 'مساحة المريض' : 'Espace patient'}</p>
          <h1 className="medic-page-title mt-2">{ar ? `مرحباً، ${profile?.firstName ?? ''}` : `Bonjour, ${profile?.firstName ?? ''}`}</h1>
          <p className="mt-2 text-sm text-slate-500">{ar ? 'اعتنِ بصحتك اليوم، وفريقك معك.' : 'Prenez soin de vous aujourd’hui. Votre équipe reste à vos côtés.'}</p>
        </div>
        <div className="flex items-center gap-5 rounded-2xl border border-sky-100 bg-gradient-to-br from-sky-100 to-brand-50 px-5 py-4 sm:max-w-sm">
          <div><p className="text-sm font-semibold leading-6 text-sky-900">{ar ? 'فريق بجانبك لحياة أكثر صحة.' : 'Une équipe à vos côtés, pour une vie en meilleure santé.'}</p><Link href="/doctors" className="mt-3 inline-flex items-center gap-2 text-xs font-bold text-brand-700 hover:underline"><Plus className="h-4 w-4" />{ar ? 'حجز موعد' : 'Prendre rendez-vous'}</Link></div>
          <span aria-hidden className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-white/70 text-brand-600 shadow-sm"><HeartPulse className="h-9 w-9" strokeWidth={1.5} /></span>
        </div>
      </div>

      <div className="mt-7 grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <div className="space-y-5">
          <div className="grid gap-5 md:grid-cols-2">
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
                  <Link href="/p/appointments" className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-sky-800 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-900">{ar ? 'عرض التفاصيل' : 'Voir les détails'}<ArrowRight className="h-4 w-4 rtl:rotate-180" /></Link>
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
                <QuickAction href="/p/messages" icon={MessageSquare} title={ar ? 'الرسائل' : 'Messages'} text={ar ? 'تواصل بأمان مع فريق الرعاية.' : 'Échangez en sécurité avec votre équipe.'} />
              </div>
            </article>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <article className="medic-card overflow-hidden"><div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4"><FileText className="h-5 w-5 text-brand-600" /><h2 className="font-bold">{ar ? 'مستنداتي' : 'Mes documents'}</h2></div>
              <div className="space-y-4 p-5">{recentDocuments.length ? recentDocuments.map(doc => <Link key={doc.id} href="/p/documents" className="flex items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-sky-50 text-sky-700"><FileText className="h-5 w-5" /></span><div className="min-w-0"><p className="truncate text-sm font-semibold">{doc.title || doc.medicationSummary || (ar ? 'مستند طبي' : 'Document médical')}</p><p className="mt-1 text-xs text-slate-400">{doc.issuedAt.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Tunis' })}</p></div></Link>) : <p className="medic-muted">{ar ? 'لا توجد مستندات بعد.' : 'Vos prochains documents apparaîtront ici.'}</p>}</div>
              <Link href="/p/documents" className="mx-5 mb-5 block rounded-xl bg-sky-50 py-3 text-center text-sm font-semibold text-sky-800">{ar ? 'عرض الملف' : 'Voir le dossier'}</Link>
            </article>
            <article className="medic-card overflow-hidden"><div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4"><MessageSquare className="h-5 w-5 text-brand-600" /><h2 className="font-bold">{ar ? 'الرسائل' : 'Messages'}</h2></div><PatientThreads threads={threads.filter(thread => doctorIds[thread.linkId]).slice(0, 3)} doctorIds={doctorIds} locale={locale} /><Link href="/p/messages" className="block border-t border-slate-100 py-4 text-center text-sm font-semibold text-sky-700">{ar ? 'عرض كل الرسائل' : 'Voir tous les messages'}</Link></article>
          </div>
        </div>

        <aside className="space-y-5">
          <article className="medic-card p-5">
            <div className="flex items-center justify-between"><h2 className="flex items-center gap-2 font-bold text-navy-950"><AlertTriangle className="h-5 w-5 text-amber-500" />{ar ? 'الحساسيات' : 'Allergies'}</h2><Link href="/p/allergies" className="text-xs font-semibold text-brand-700 hover:underline">{ar ? 'تعديل' : 'Modifier'}</Link></div>
            <div className={`mt-4 rounded-xl p-4 ${profile?.allergiesEnc ? 'bg-amber-50' : profile?.allergiesAffirmedNone ? 'bg-emerald-50' : 'bg-slate-50'}`}>
              <p className="text-sm font-semibold text-navy-950">{profile?.allergiesEnc ? (ar ? 'تم تسجيل الحساسية' : 'Allergies renseignées') : profile?.allergiesAffirmedNone ? (ar ? 'لا توجد حساسية معروفة' : 'Aucune allergie connue') : (ar ? 'معلومات غير مكتملة' : 'Information à compléter')}</p>
              <p className="mt-2 text-xs leading-5 text-slate-600">{ar ? 'تظهر هذه المعلومات للطبيب عند وصف الدواء.' : 'Cette information est présentée au médecin lors de la prescription.'}</p>
            </div>
          </article>

          <article className="medic-card overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="flex items-center gap-2 text-base font-bold text-navy-950"><Users className="h-5 w-5 text-brand-600" />{ar ? 'فريق الرعاية الخاص بي' : 'Mon équipe de soin'}</h2>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{doctors.length}</span>
            </div>
            {doctors.length === 0 ? (
              <div className="p-8 text-center"><p className="text-sm text-slate-500">{ar ? 'لا يوجد أطباء مرتبطون بعد.' : 'Aucun médecin lié pour le moment.'}</p><Link href="/doctors" className="mt-3 inline-block text-sm font-semibold text-brand-700 hover:underline">{ar ? 'اكتشف الأطباء' : 'Découvrir les médecins'}</Link></div>
            ) : (
              <ul className="grid gap-3 p-5">
                {doctors.map(({ doctor, _count }) => {
                  const name = (doctor.headline as Record<Locale, string>)?.[locale as Locale] ?? '';
                  const specialty = (doctor.specialty.name as Record<Locale, string>)?.[locale as Locale] ?? '';
                  return (
                    <li key={doctor.id} className="border-b border-slate-100 pb-4 last:border-0">
                      <div className="flex items-center gap-3"><Avatar icon={Stethoscope} /><div className="min-w-0"><p className="truncate text-sm font-bold text-navy-950">{name}</p><p className="truncate text-xs text-slate-500">{specialty}</p></div></div>
                      <div className="mt-4 flex flex-wrap gap-2"><Link href={`/p/doctors/${doctor.id}/book`} className="rounded-lg bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-800 hover:bg-brand-100">{ar ? 'حجز' : 'Réserver'}</Link><Link href={`/p/doctors/${doctor.id}/messages`} className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200">{ar ? 'رسالة' : 'Message'}</Link><Link href={`/p/doctors/${doctor.id}/documents`} className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200">{ar ? 'الوثائق' : `Documents (${_count.documents})`}</Link></div>
                    </li>
                  );
                })}
              </ul>
            )}
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
  return <span className={`${centered ? 'mx-auto' : ''} grid h-12 w-12 shrink-0 place-items-center rounded-full bg-sky-50 text-sky-700`}><Icon className="h-5 w-5" /></span>;
}

function QuickAction({ href, icon: Icon, title, text }: { href: string; icon: typeof CalendarDays; title: string; text: string }) {
  return <Link href={href} className="group flex items-center gap-4 py-4"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-sky-50 text-sky-700"><Icon className="h-5 w-5" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-navy-950">{title}</span><span className="mt-0.5 block text-xs leading-5 text-slate-500">{text}</span></span><ArrowRight className="h-4 w-4 text-slate-300 transition group-hover:text-brand-600 rtl:rotate-180" /></Link>;
}

function SmallMetric({ value, label }: { value: string; label: string }) {
  return <div className="rounded-xl bg-slate-50 p-4 text-center"><p className="text-2xl font-bold text-navy-950">{value}</p><p className="mt-1 text-xs text-slate-500">{label}</p></div>;
}
