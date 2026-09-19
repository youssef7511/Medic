import { redirect } from 'next/navigation';
import { getCurrentActor } from '@/lib/auth/session';
import { hasPermission } from '@/lib/rbac/guard';
import { prisma } from '@/lib/db';
import { UserActions } from './UserActions';
import { KeyRound, UserCog, Users, UserX } from 'lucide-react';

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

  const [users, doctorScopes] = await Promise.all([
    prisma.user.findMany({
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
    }),
    canManage
      ? prisma.doctorProfile.findMany({
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            headline: true,
            user: { select: { email: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const doctorOptions = doctorScopes.map((doctor) => {
    const headline = doctor.headline as Record<string, string>;
    return {
      id: doctor.id,
      label: doctor.user.email ?? headline[locale] ?? headline.fr ?? doctor.id,
    };
  });
  const activeUsers = users.filter((user) => user.status === 'ACTIVE').length;
  const suspendedUsers = users.filter((user) => user.status === 'SUSPENDED').length;
  const mfaUsers = users.filter((user) => Boolean(user.mfaSecret)).length;

  return (
    <section>
      <div><p className="medic-kicker">{ar ? 'الهوية والوصول' : 'Identités et accès'}</p><h1 className="medic-page-title mt-2">{ar ? 'إدارة المستخدمين' : 'Gestion des utilisateurs'}</h1><p className="mt-2 text-sm text-slate-500">{ar ? 'إدارة الحالات والأدوار وإعداد المصادقة الثنائية.' : 'Gérez les statuts, les rôles et l’enrôlement MFA.'}</p></div>

      <div className="mt-7 grid gap-4 sm:grid-cols-3">
        <Summary icon={Users} value={activeUsers} label={ar ? 'حسابات نشطة' : 'Comptes actifs'} tone="green" />
        <Summary icon={UserX} value={suspendedUsers} label={ar ? 'حسابات معلقة' : 'Comptes suspendus'} tone="red" />
        <Summary icon={KeyRound} value={mfaUsers} label={ar ? 'MFA مفعّل' : 'MFA configuré'} tone="brand" />
      </div>

      <div className="medic-panel mt-5 overflow-x-auto">
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4"><span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700"><UserCog className="h-5 w-5" /></span><div><h2 className="text-sm font-bold text-navy-950">{ar ? 'دليل الحسابات' : 'Répertoire des comptes'}</h2><p className="mt-0.5 text-xs text-slate-500">{users.length} {ar ? 'مستخدم' : 'utilisateur(s)'}</p></div></div>
        <table className="w-full min-w-[820px] text-start text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/80 text-xs text-slate-500">
              <th className="px-5 py-3 font-semibold">{ar ? 'البريد والملف' : 'Email et profil'}</th>
              <th className="px-5 py-3 font-semibold">{ar ? 'الأدوار' : 'Rôles'}</th>
              <th className="px-5 py-3 font-semibold">MFA</th>
              <th className="px-5 py-3 font-semibold">{ar ? 'الحالة' : 'Statut'}</th>
              {canManage && <th className="px-5 py-3 font-semibold">{ar ? 'إجراءات' : 'Actions'}</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-slate-50/70">
                <td className="px-5 py-4">
                  <p className="font-semibold text-navy-950">{user.email ?? '—'}</p>
                  {user.doctorProfile && (
                    <p className="mt-1 text-xs text-slate-400">
                      {ar ? 'طبيب' : 'Médecin'}
                      {user.doctorProfile.isPublished
                        ? ` · ${ar ? 'منشور' : ' Publié'}`
                        : ` · ${ar ? 'غير منشور' : ' Non publié'}`}
                    </p>
                  )}
                  {user.patientProfile && (
                    <p className="mt-1 text-xs text-slate-400">{ar ? 'مريض' : 'Patient'}</p>
                  )}
                </td>
                <td className="px-5 py-4">
                  <div className="flex flex-wrap gap-1">
                    {user.roleAssignments.map((r) => (
                      <span
                        key={r.id}
                        className="rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700"
                      >
                        {r.role}
                        {r.scopeType === 'DOCTOR' ? ` (${r.scopeId.slice(0, 8)}…)` : ''}
                      </span>
                    ))}
                    {user.roleAssignments.length === 0 && (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </div>
                </td>
                <td className="px-5 py-4"><span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${user.mfaSecret ? 'text-emerald-700' : 'text-amber-700'}`}><span className={`h-1.5 w-1.5 rounded-full ${user.mfaSecret ? 'bg-emerald-500' : 'bg-amber-500'}`} />{user.mfaSecret ? (ar ? 'مفعّل' : 'Configuré') : (ar ? 'مطلوب' : 'À configurer')}</span></td>
                <td className="px-5 py-4">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      user.status === 'ACTIVE'
                        ? 'bg-emerald-50 text-emerald-700'
                        : user.status === 'SUSPENDED'
                          ? 'bg-red-50 text-red-700'
                          : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {user.status}
                  </span>
                </td>
                {canManage && (
                  <td className="px-5 py-4">
                    <UserActions
                      userId={user.id}
                      userEmail={user.email ?? user.id}
                      currentStatus={user.status}
                      mfaEnrolled={Boolean(user.mfaSecret)}
                      doctorOptions={doctorOptions}
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

const SUMMARY_TONE = { green: 'bg-emerald-50 text-emerald-700', red: 'bg-red-50 text-red-700', brand: 'bg-brand-50 text-brand-700' };

function Summary({ icon: Icon, value, label, tone }: { icon: typeof Users; value: number; label: string; tone: keyof typeof SUMMARY_TONE }) {
  return <div className="medic-card flex items-center gap-4 p-5"><span className={`grid h-11 w-11 place-items-center rounded-xl ${SUMMARY_TONE[tone]}`}><Icon className="h-5 w-5" /></span><div><p className="text-2xl font-bold text-navy-950">{value}</p><p className="text-xs text-slate-500">{label}</p></div></div>;
}
