import { redirect } from 'next/navigation';
import {
  ArrowRight,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Clock3,
  MessageSquare,
  Settings2,
  Users,
} from 'lucide-react';
import { getCurrentActor } from '@/lib/auth/session';
import { getDoctorAppointments } from '@/lib/booking/queries';
import { AppointmentStatusBadge } from '@/components/AppointmentStatusBadge';
import { prisma } from '@/lib/db';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/config';
import { AppointmentActions } from './AppointmentActions';

export const dynamic = 'force-dynamic';

export default async function DoctorSchedulePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const ar = locale === 'ar';
  const actor = await getCurrentActor();
  if (!actor) redirect(`/${locale}/login`);

  const [appointments, profile] = await Promise.all([
    getDoctorAppointments(actor.userId, locale),
    prisma.doctorProfile.findUnique({
      where: { userId: actor.userId },
      select: { headline: true, timezone: true, _count: { select: { links: true } } },
    }),
  ]);

  const pending = appointments.filter((item) => item.status === 'REQUESTED');
  const confirmed = appointments.filter((item) => item.status === 'CONFIRMED' && !item.isPast);
  const timezone = profile?.timezone ?? 'Africa/Tunis';
  const dateKey = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(date);
  const todayKey = dateKey(new Date());
  const today = appointments.filter((item) => dateKey(new Date(item.startAtIso)) === todayKey);
  const nextAppointments = appointments.filter((item) => !item.isPast && item.status !== 'CANCELLED').slice(0, 6);
  const displayName = (profile?.headline as Record<Locale, string> | undefined)?.[locale as Locale] ?? (ar ? 'طبيب' : 'Docteur');

  return (
    <section>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="medic-kicker">{ar ? 'مساحة الطبيب' : 'Espace médecin'}</p>
          <h1 className="medic-page-title mt-2">{ar ? `مرحباً، ${displayName}` : `Bonjour, ${displayName}`}</h1>
          <p className="mt-2 text-sm text-slate-500">{ar ? 'إليك نظرة عامة على نشاط عيادتك.' : 'Voici la vue d’ensemble de votre activité.'}</p>
        </div>
        <Link href="/d/calendar" className="inline-flex items-center justify-center gap-2 self-start rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 sm:self-auto"><CalendarDays className="h-4 w-4" />{ar ? 'فتح التقويم' : 'Ouvrir l’agenda'}</Link>
      </div>

      <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={CalendarClock} label={ar ? 'اليوم' : 'Aujourd’hui'} value={today.length} tone="brand" />
        <Stat icon={Clock3} label={ar ? 'في الانتظار' : 'En attente'} value={pending.length} tone="amber" />
        <Stat icon={CheckCircle2} label={ar ? 'مؤكدة' : 'Confirmés'} value={confirmed.length} tone="green" />
        <Stat icon={Users} label={ar ? 'المرضى النشطون' : 'Patients actifs'} value={profile?._count.links ?? 0} tone="blue" />
      </div>

      {pending.length > 0 && (
        <div className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
          <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div><p className="text-sm font-semibold text-amber-900">{ar ? `${pending.length} طلب موعد يحتاج إلى قرار.` : `${pending.length} demande(s) de rendez-vous nécessitent votre réponse.`}</p><p className="mt-1 text-xs text-amber-700">{ar ? 'قم بالتأكيد أو الرفض من قائمة المواعيد أدناه.' : 'Confirmez ou refusez-les depuis la liste ci-dessous.'}</p></div>
        </div>
      )}

      <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.55fr)]">
        <article className="medic-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div><h2 className="text-base font-bold text-navy-950">{ar ? 'المواعيد القادمة' : 'Prochains rendez-vous'}</h2><p className="mt-1 text-xs text-slate-500">{ar ? 'الطلبات المؤكدة والمعلقة.' : 'Demandes confirmées et en attente.'}</p></div>
            <Link href="/d/calendar" className="text-xs font-semibold text-brand-700 hover:underline">{ar ? 'عرض التقويم' : 'Voir l’agenda'}</Link>
          </div>
          {nextAppointments.length === 0 ? (
            <div className="p-10 text-center"><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-500"><CalendarDays className="h-6 w-6" /></span><p className="mt-4 text-sm font-semibold text-navy-950">{ar ? 'لا توجد مواعيد قادمة.' : 'Aucun rendez-vous à venir.'}</p></div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {nextAppointments.map((appointment) => (
                <li key={appointment.id} className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-sm font-bold text-brand-800">{appointment.counterpartyName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span>
                    <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-bold text-navy-950">{appointment.counterpartyName}</p><AppointmentStatusBadge status={appointment.status} locale={locale} /></div><p className="mt-1 text-sm capitalize text-slate-600">{appointment.whenLabel}</p><p className="mt-0.5 text-xs text-slate-400">{appointment.clinicName}</p></div>
                  </div>
                  <AppointmentActions appointmentId={appointment.id} status={appointment.status} isPast={appointment.isPast} locale={locale} />
                </li>
              ))}
            </ul>
          )}
        </article>

        <aside className="space-y-5">
          <article className="medic-card p-5">
            <h2 className="text-base font-bold text-navy-950">{ar ? 'إجراءات سريعة' : 'Actions rapides'}</h2>
            <div className="mt-3 divide-y divide-slate-100">
              <Action href="/d/calendar" icon={CalendarDays} label={ar ? 'إدارة التقويم' : 'Gérer l’agenda'} />
              <Action href="/d/availability" icon={Settings2} label={ar ? 'تعديل التوفر' : 'Modifier les disponibilités'} />
              <Action href="/d/threads" icon={MessageSquare} label={ar ? 'فتح الرسائل' : 'Ouvrir les conversations'} />
            </div>
          </article>
          <article className="overflow-hidden rounded-2xl bg-navy-950 p-5 text-white shadow-card">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-300">{ar ? 'تذكير' : 'Bon réflexe'}</p>
            <h2 className="mt-3 font-bold">{ar ? 'تحقق من معلومات الحساسية' : 'Vérifiez toujours les allergies'}</h2>
            <p className="mt-2 text-xs leading-5 text-slate-300">{ar ? 'تظهر حالة الحساسية في ملف المريض قبل وصف الدواء.' : 'Le statut allergique est affiché dans le dossier patient avant toute prescription.'}</p>
          </article>
        </aside>
      </div>
    </section>
  );
}

const TONE = {
  brand: 'bg-brand-50 text-brand-700',
  amber: 'bg-amber-50 text-amber-700',
  green: 'bg-emerald-50 text-emerald-700',
  blue: 'bg-blue-50 text-blue-700',
};

function Stat({ icon: Icon, label, value, tone }: { icon: typeof CalendarDays; label: string; value: number; tone: keyof typeof TONE }) {
  return <div className="medic-card flex items-center gap-4 p-5"><span className={`grid h-11 w-11 place-items-center rounded-xl ${TONE[tone]}`}><Icon className="h-5 w-5" /></span><div><p className="text-2xl font-bold text-navy-950">{value}</p><p className="text-xs text-slate-500">{label}</p></div></div>;
}

function Action({ href, icon: Icon, label }: { href: string; icon: typeof CalendarDays; label: string }) {
  return <Link href={href} className="group flex items-center gap-3 py-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-600 group-hover:bg-brand-50 group-hover:text-brand-700"><Icon className="h-4 w-4" /></span><span className="flex-1 text-sm font-semibold text-slate-700 group-hover:text-navy-950">{label}</span><ArrowRight className="h-4 w-4 text-slate-300 group-hover:text-brand-600 rtl:rotate-180" /></Link>;
}
