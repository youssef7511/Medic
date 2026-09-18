import { redirect } from 'next/navigation';
import { getCurrentActor } from '@/lib/auth/session';
import { hasPermission } from '@/lib/rbac/guard';
import { prisma } from '@/lib/db';
import { Link } from '@/i18n/navigation';

export const dynamic = 'force-dynamic';

/**
 * Admin dashboard (§6, Phase 6). Shows counts of pending verifications,
 * total users, and recent audit entries. Both SUPER_ADMIN and SUPPORT_ADMIN
 * can see this page; certain actions are SUPER_ADMIN-only (§5).
 */
export default async function AdminHomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const ar = locale === 'ar';

  const actor = await getCurrentActor();
  if (!actor) redirect(`/${locale}/login`);

  const [
    pendingVerification,
    publishedDoctors,
    totalUsers,
    recentAuditCount,
  ] = await Promise.all([
    prisma.doctorProfile.count({ where: { isPublished: false } }),
    prisma.doctorProfile.count({ where: { isPublished: true } }),
    prisma.user.count({ where: { status: 'ACTIVE' } }),
    prisma.auditLog.count(),
  ]);

  const canManageUsers = hasPermission(actor, 'role:assign');

  return (
    <section>
      <h1 className="mb-6 text-2xl font-bold">
        {ar ? 'لوحة التحكم' : 'Tableau de bord'}
      </h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Pending verification */}
        <Link
          href="/admin/doctors"
          className="rounded-lg border border-gray-200 bg-white p-4 hover:bg-gray-50"
        >
          <p className="text-sm text-gray-500">
            {ar ? 'في انتظار التحقق' : 'En attente de vérification'}
          </p>
          <p className="mt-1 text-3xl font-bold text-amber-600">{pendingVerification}</p>
        </Link>

        {/* Published doctors */}
        <Link
          href="/admin/doctors"
          className="rounded-lg border border-gray-200 bg-white p-4 hover:bg-gray-50"
        >
          <p className="text-sm text-gray-500">
            {ar ? 'أطباء منشورون' : 'Médecins publiés'}
          </p>
          <p className="mt-1 text-3xl font-bold text-green-600">{publishedDoctors}</p>
        </Link>

        {/* Total users */}
        {canManageUsers && (
          <Link
            href="/admin/users"
            className="rounded-lg border border-gray-200 bg-white p-4 hover:bg-gray-50"
          >
            <p className="text-sm text-gray-500">
              {ar ? 'المستخدمون النشطون' : 'Utilisateurs actifs'}
            </p>
            <p className="mt-1 text-3xl font-bold text-brand-600">{totalUsers}</p>
          </Link>
        )}

        {/* Audit entries */}
        <Link
          href="/admin/audit"
          className="rounded-lg border border-gray-200 bg-white p-4 hover:bg-gray-50"
        >
          <p className="text-sm text-gray-500">
            {ar ? 'سجل التدقيق' : 'Entrées d\'audit'}
          </p>
          <p className="mt-1 text-3xl font-bold text-gray-900">{recentAuditCount}</p>
        </Link>
      </div>

      <p className="mt-6 text-sm text-gray-400">
        {ar
          ? 'المشرفون لا يستطيعون قراءة الملاحظات السريرية أو الرسائل (§5). يتطلب الوصول السريري تدفقات كسر الزجاج المحطّم.'
          : 'Les admins ne peuvent pas lire les notes ou messages cliniques (§5). L\'accès clinique nécessite le flow break-glass.'}
      </p>
    </section>
  );
}
