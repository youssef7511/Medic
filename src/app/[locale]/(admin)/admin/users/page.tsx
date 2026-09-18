import { redirect } from 'next/navigation';
import { getCurrentActor } from '@/lib/auth/session';
import { hasPermission } from '@/lib/rbac/guard';
import { prisma } from '@/lib/db';
import { UserActions } from './UserActions';

export const dynamic = 'force-dynamic';

/**
 * User management (§6, Phase 6). Lists all users with their roles and status.
 * SUPER_ADMIN can suspend users and assign roles.
 * SUPPORT_ADMIN can view but not act.
 *
 * §5: SUPER_ADMIN has role:assign + user:suspend. SUPPORT_ADMIN has neither.
 */
export default async function AdminUsersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const ar = locale === 'ar';

  const actor = await getCurrentActor();
  if (!actor) redirect(`/${locale}/login`);

  const canManage = hasPermission(actor, 'role:assign');

  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      roleAssignments: {
        select: {
          id: true,
          role: true,
          scopeType: true,
          scopeId: true,
          grantedAt: true,
          expiresAt: true,
        },
      },
      patientProfile: { select: { id: true } },
      doctorProfile: {
        select: { id: true, isPublished: true, headline: true },
      },
    },
  });

  return (
    <section>
      <h1 className="mb-6 text-2xl font-bold">
        {ar ? 'إدارة المستخدمين' : 'Gestion des utilisateurs'}
      </h1>

      <div className="overflow-x-auto">
        <table className="w-full text-start text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-gray-500">
              <th className="px-4 py-2 font-medium">{ar ? 'الاسم' : 'Nom'}</th>
              <th className="px-4 py-2 font-medium">{ar ? 'البريد' : 'Email'}</th>
              <th className="px-4 py-2 font-medium">{ar ? 'الأدوار' : 'Rôles'}</th>
              <th className="px-4 py-2 font-medium">{ar ? 'الحالة' : 'Statut'}</th>
              {canManage && <th className="px-4 py-2 font-medium">{ar ? 'إجراءات' : 'Actions'}</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <p className="font-medium">{user.email}</p>
                  {user.doctorProfile && (
                    <p className="text-xs text-gray-400">
                      {ar ? 'طبيب' : 'Médecin'}
                      {user.doctorProfile.isPublished
                        ? ` · ${ar ? 'منشور' : ' Publié'}`
                        : ` · ${ar ? 'غير منشور' : ' Non publié'}`}
                    </p>
                  )}
                  {user.patientProfile && (
                    <p className="text-xs text-gray-400">{ar ? 'مريض' : 'Patient'}</p>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-600">{user.email}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {user.roleAssignments.map((r) => (
                      <span
                        key={r.id}
                        className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
                      >
                        {r.role}
                        {r.scopeId ? ` (${r.scopeId.slice(0, 8)}…)` : ''}
                      </span>
                    ))}
                    {user.roleAssignments.length === 0 && (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      user.status === 'ACTIVE'
                        ? 'bg-green-50 text-green-700'
                        : user.status === 'SUSPENDED'
                          ? 'bg-red-50 text-red-700'
                          : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {user.status}
                  </span>
                </td>
                {canManage && (
                  <td className="px-4 py-3">
                    <UserActions
                      userId={user.id}
                      userName={user.email ?? user.id}
                      currentStatus={user.status}
                      locale={locale}
                    />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
