import { redirect } from 'next/navigation';
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  FileCheck2,
  ScrollText,
  Settings,
  ShieldAlert,
  Stethoscope,
  Users,
} from 'lucide-react';
import { getCurrentActor } from '@/lib/auth/session';
import { hasPermission } from '@/lib/rbac/guard';
import { prisma } from '@/lib/db';
import { Link } from '@/i18n/navigation';

export const dynamic = 'force-dynamic';

export default async function AdminHomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const ar = locale === 'ar';
  const actor = await getCurrentActor();
  if (!actor) redirect(`/${locale}/login`);

  const [pendingVerification, publishedDoctors, totalUsers, auditCount, pendingDoctors, recentAudit] = await Promise.all([
    prisma.doctorProfile.count({ where: { isPublished: false } }),
    prisma.doctorProfile.count({ where: { isPublished: true } }),
    prisma.user.count({ where: { status: 'ACTIVE' } }),
    prisma.auditLog.count(),
    prisma.doctorProfile.findMany({
      where: { isPublished: false },
      orderBy: { createdAt: 'asc' },
      take: 5,
      select: { id: true, headline: true, licenseNumber: true, licenseVerifiedAt: true, specialty: { select: { name: true } } },
    }),
    prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, action: true, actorRole: true, createdAt: true } }),
  ]);

  const canManageUsers = hasPermission(actor, 'role:assign');
  const canReadSettings = hasPermission(actor, 'platform_settings:read');
  const canBreakGlass = hasPermission(actor, 'break_glass:activate');

  return (
    <section>
      <div>
        <p className="medic-kicker">{ar ? 'الأمان والامتثال والثقة' : 'Sécurité · Conformité · Confiance'}</p>
        <h1 className="medic-page-title mt-2">{ar ? 'الإدارة' : 'Administration'}</h1>
        <p className="mt-2 text-sm text-slate-500">{ar ? 'راقب العمليات الحساسة وإدارة وصول المنصة.' : 'Pilotez les opérations sensibles et les accès à la plateforme.'}</p>
      </div>

      <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric href="/admin/doctors" icon={FileCheck2} label={ar ? 'عمليات التحقق المعلقة' : 'Vérifications en attente'} value={pendingVerification} tone="amber" />
        <Metric href="/admin/doctors" icon={Stethoscope} label={ar ? 'الأطباء المنشورون' : 'Médecins publiés'} value={publishedDoctors} tone="brand" />
        {canManageUsers && <Metric href="/admin/users" icon={Users} label={ar ? 'المستخدمون النشطون' : 'Utilisateurs actifs'} value={totalUsers} tone="blue" />}
        <Metric href="/admin/audit" icon={ScrollText} label={ar ? 'إدخالات التدقيق' : 'Entrées d’audit'} value={auditCount} tone="slate" />
      </div>

      <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <article className="medic-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div><h2 className="text-base font-bold text-navy-950">{ar ? 'قائمة التحقق من الأطباء' : 'File de vérification des médecins'}</h2><p className="mt-1 text-xs text-slate-500">{ar ? 'تحقق من الترخيص قبل النشر.' : 'Vérifiez la licence avant toute publication.'}</p></div>
            <Link href="/admin/doctors" className="text-xs font-semibold text-brand-700 hover:underline">{ar ? 'عرض الكل' : 'Voir tout'}</Link>
          </div>
          {pendingDoctors.length === 0 ? (
            <div className="p-10 text-center"><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-700"><CheckCircle2 className="h-6 w-6" /></span><p className="mt-4 text-sm font-semibold text-navy-950">{ar ? 'لا يوجد تحقق معلق.' : 'Aucune vérification en attente.'}</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-start text-sm">
                <thead><tr className="border-b border-slate-100 bg-slate-50/80 text-xs text-slate-500"><th className="px-5 py-3 font-semibold">{ar ? 'الطبيب' : 'Médecin'}</th><th className="px-5 py-3 font-semibold">{ar ? 'التخصص' : 'Spécialité'}</th><th className="px-5 py-3 font-semibold">{ar ? 'الترخيص' : 'Licence'}</th><th className="px-5 py-3 font-semibold">{ar ? 'الحالة' : 'Statut'}</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {pendingDoctors.map((doctor) => {
                    const headline = (doctor.headline as Record<string, string>)?.[locale] ?? '';
                    const specialty = (doctor.specialty.name as Record<string, string>)?.[locale] ?? '';
                    return <tr key={doctor.id} className="hover:bg-slate-50"><td className="px-5 py-4 font-semibold text-navy-950">{headline || doctor.licenseNumber}</td><td className="px-5 py-4 text-slate-600">{specialty}</td><td className="px-5 py-4 font-mono text-xs text-slate-500">{doctor.licenseNumber}</td><td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${doctor.licenseVerifiedAt ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{doctor.licenseVerifiedAt ? (ar ? 'تم التحقق' : 'Vérifiée') : (ar ? 'في الانتظار' : 'À vérifier')}</span></td></tr>;
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-3"><Link href="/admin/doctors" className="inline-flex items-center gap-2 text-xs font-semibold text-brand-700 hover:underline">{ar ? 'إدارة عمليات التحقق' : 'Gérer les vérifications'}<ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" /></Link></div>
        </article>

        <article className="medic-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="text-base font-bold text-navy-950">{ar ? 'نشاط التدقيق الأخير' : 'Activité récente du journal'}</h2><p className="mt-1 text-xs text-slate-500">{ar ? 'آخر الأحداث الأمنية.' : 'Derniers événements de sécurité.'}</p></div><Activity className="h-5 w-5 text-brand-600" /></div>
          <div className="divide-y divide-slate-100 px-5">
            {recentAudit.map((entry) => <div key={entry.id} className="flex items-center gap-3 py-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600"><ScrollText className="h-4 w-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-navy-950">{formatAction(entry.action)}</p><p className="mt-0.5 text-xs text-slate-400">{entry.actorRole}</p></div><time className="shrink-0 text-xs text-slate-400">{entry.createdAt.toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time></div>)}
            {recentAudit.length === 0 && <p className="py-8 text-center text-sm text-slate-500">{ar ? 'لا يوجد نشاط.' : 'Aucune activité.'}</p>}
          </div>
          <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-3"><Link href="/admin/audit" className="inline-flex items-center gap-2 text-xs font-semibold text-brand-700 hover:underline">{ar ? 'فتح سجل التدقيق' : 'Ouvrir le journal'}<ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" /></Link></div>
        </article>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {canReadSettings && <Link href="/admin/settings" className="medic-card group flex items-start gap-4 p-5 hover:border-brand-200"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700"><Settings className="h-5 w-5" /></span><div className="flex-1"><h2 className="font-bold text-navy-950">{ar ? 'إعدادات المنصة' : 'Paramètres de la plateforme'}</h2><p className="mt-1 text-xs leading-5 text-slate-500">{ar ? 'التسجيل وجهات اتصال الدعم والتكوين التشغيلي.' : 'Inscription, contacts de support et configuration opérationnelle.'}</p></div><ArrowRight className="mt-1 h-4 w-4 text-slate-300 group-hover:text-brand-600 rtl:rotate-180" /></Link>}
        {canBreakGlass && <Link href="/admin/break-glass" className="group flex items-start gap-4 rounded-2xl border border-red-200 bg-red-50 p-5 shadow-card hover:border-red-300"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-red-600"><ShieldAlert className="h-5 w-5" /></span><div className="flex-1"><h2 className="font-bold text-red-900">Break-glass</h2><p className="mt-1 text-xs leading-5 text-red-700">{ar ? 'وصول طارئ ومؤقت ومراقب بالكامل.' : 'Accès d’urgence temporaire, justifié et entièrement journalisé.'}</p></div><ArrowRight className="mt-1 h-4 w-4 text-red-300 group-hover:text-red-600 rtl:rotate-180" /></Link>}
      </div>

      <p className="mt-6 flex items-center gap-2 text-xs text-slate-400"><ShieldAlert className="h-4 w-4" />{ar ? 'لا يستطيع المسؤولون قراءة المحتوى السريري خارج عملية break-glass المراقبة.' : 'Les administrateurs ne peuvent pas lire le contenu clinique hors du flow break-glass contrôlé.'}</p>
    </section>
  );
}

const TONE = {
  amber: 'bg-amber-50 text-amber-700',
  brand: 'bg-brand-50 text-brand-700',
  blue: 'bg-blue-50 text-blue-700',
  slate: 'bg-slate-100 text-slate-700',
};

function Metric({ href, icon: Icon, label, value, tone }: { href: string; icon: typeof Users; label: string; value: number; tone: keyof typeof TONE }) {
  return <Link href={href} className="medic-card group flex items-center gap-4 p-5 hover:border-brand-200"><span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${TONE[tone]}`}><Icon className="h-5 w-5" /></span><div className="min-w-0 flex-1"><p className="text-2xl font-bold text-navy-950">{value.toLocaleString('fr-FR')}</p><p className="truncate text-xs text-slate-500">{label}</p></div><ArrowRight className="h-4 w-4 text-slate-300 group-hover:text-brand-600 rtl:rotate-180" /></Link>;
}

function formatAction(action: string) {
  return action.replaceAll('.', ' · ').replaceAll('_', ' ');
}
