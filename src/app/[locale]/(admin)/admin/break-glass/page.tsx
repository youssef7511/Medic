import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getCurrentActor } from '@/lib/auth/session';
import { hasPermission } from '@/lib/rbac/guard';
import { BreakGlassForm } from './BreakGlassForm';
import { Clock3, ShieldAlert } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function BreakGlassPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const ar = locale === 'ar';
  const actor = await getCurrentActor();
  if (!actor) redirect(`/${locale}/login`);
  if (!hasPermission(actor, 'break_glass:activate')) notFound();

  const grants = await prisma.breakGlassGrant.findMany({
    where: { actorUserId: actor.userId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: { patient: { select: { firstName: true, lastName: true } } },
  });
  const now = Date.now();

  return (
    <section className="max-w-4xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-red-600">{ar ? 'وصول استثنائي' : 'Accès exceptionnel'}</p><h1 className="medic-page-title mt-2 text-red-900">Break-glass</h1>
        <p className="mt-2 text-sm text-slate-600">
          {ar
            ? 'وصول استثنائي ومؤقت. يتطلب MFA وسببًا، ويتم تدقيق كل قراءة وإشعار المريض.'
            : 'Accès exceptionnel et temporaire. MFA et justification obligatoires; chaque lecture est auditée et le patient est notifié.'}
        </p>
      </div>

      <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4"><ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-600" /><div><p className="text-sm font-bold text-red-900">{ar ? 'للطوارئ فقط' : 'Réservé aux urgences réelles'}</p><p className="mt-1 text-xs leading-5 text-red-700">{ar ? 'كل قراءة سريرية أثناء الوصول تُسجل وتخضع للمراجعة.' : 'Chaque lecture clinique pendant l’accès est journalisée et révisable.'}</p></div></div>

      <BreakGlassForm locale={locale} />

      <div>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-navy-950"><Clock3 className="h-5 w-5 text-slate-500" />{ar ? 'آخر عمليات الوصول' : 'Accès récents'}</h2>
        <div className="space-y-2">
          {grants.map((grant) => {
            const active = grant.status === 'ACTIVE' && grant.expiresAt.getTime() > now;
            return (
              <div key={grant.id} className="medic-card flex items-center justify-between gap-4 p-4 text-sm">
                <p className="font-medium">{grant.patient.firstName} {grant.patient.lastName}</p>
                <p className={active ? 'text-red-700' : 'text-gray-500'}>
                  {active ? (ar ? 'نشط' : 'ACTIF') : (ar ? 'منتهي أو ملغى' : 'Expiré ou révoqué')} · {grant.expiresAt.toLocaleString(locale)}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
