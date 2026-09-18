import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getCurrentActor } from '@/lib/auth/session';
import { hasPermission } from '@/lib/rbac/guard';
import { BreakGlassForm } from './BreakGlassForm';

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
    <section className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-red-800">Break-glass</h1>
        <p className="mt-2 text-sm text-gray-600">
          {ar
            ? 'وصول استثنائي ومؤقت. يتطلب MFA وسببًا، ويتم تدقيق كل قراءة وإشعار المريض.'
            : 'Accès exceptionnel et temporaire. MFA et justification obligatoires; chaque lecture est auditée et le patient est notifié.'}
        </p>
      </div>

      <BreakGlassForm locale={locale} />

      <div>
        <h2 className="mb-3 text-lg font-semibold">{ar ? 'آخر عمليات الوصول' : 'Accès récents'}</h2>
        <div className="space-y-2">
          {grants.map((grant) => {
            const active = grant.status === 'ACTIVE' && grant.expiresAt.getTime() > now;
            return (
              <div key={grant.id} className="rounded border bg-white p-3 text-sm">
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
