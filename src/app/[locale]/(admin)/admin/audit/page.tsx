import { notFound, redirect } from 'next/navigation';
import { getCurrentActor } from '@/lib/auth/session';
import { hasPermission } from '@/lib/rbac/guard';
import { prisma } from '@/lib/db';
import { Link } from '@/i18n/navigation';

export const dynamic = 'force-dynamic';

/**
 * Audit log viewer (§10, Phase 6). Append-only audit trail. Both SUPER_ADMIN
 * and SUPPORT_ADMIN can view (§5: audit:read is granted to both).
 *
 * Shows the 100 most recent entries, filterable by action type.
 * §10: "an audit row cannot be updated or deleted by application code."
 */
export default async function AdminAuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ action?: string }>;
}) {
  const { locale } = await params;
  const { action: filterAction } = await searchParams;
  const ar = locale === 'ar';

  const actor = await getCurrentActor();
  if (!actor) redirect(`/${locale}/login`);
  if (!hasPermission(actor, 'audit:read')) notFound();

  const where = filterAction ? { action: filterAction } : {};

  const [entries, actionTypes] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        actorUserId: true,
        actorRole: true,
        action: true,
        resourceType: true,
        resourceId: true,
        patientId: true,
        metadata: true,
        createdAt: true,
      },
    }),
    prisma.auditLog.groupBy({
      by: ['action'],
      _count: { action: true },
      orderBy: { _count: { action: 'desc' } },
    }),
  ]);

  return (
    <section>
      <h1 className="mb-6 text-2xl font-bold">
        {ar ? 'سجل التدقيق' : 'Journal d\'audit'}
      </h1>

      {/* Action filter */}
      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          href="/admin/audit"
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            !filterAction ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          {ar ? 'الكل' : 'Tous'}
        </Link>
        {actionTypes.map((at) => (
          <Link
            key={at.action}
            href={`/admin/audit?action=${encodeURIComponent(at.action)}`}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              filterAction === at.action
                ? 'bg-brand-500 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {at.action} ({at._count.action})
          </Link>
        ))}
      </div>

      {/* Entries */}
      {entries.length === 0 ? (
        <p className="text-sm text-gray-500">
          {ar ? 'لا توجد سجلات.' : 'Aucune entrée.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-start text-xs">
            <thead>
              <tr className="border-b border-gray-200 text-gray-500">
                <th className="px-3 py-2 font-medium">{ar ? 'التاريخ' : 'Date'}</th>
                <th className="px-3 py-2 font-medium">{ar ? 'الإجراء' : 'Action'}</th>
                <th className="px-3 py-2 font-medium">{ar ? 'الموفر' : 'Ressource'}</th>
                <th className="px-3 py-2 font-medium">{ar ? 'الممثل' : 'Acteur'}</th>
                <th className="px-3 py-2 font-medium">{ar ? 'المetadata' : 'Metadata'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {entries.map((entry) => (
                <tr key={entry.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-3 py-2 text-gray-600">
                    {entry.createdAt.toLocaleString(locale, {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="px-3 py-2">
                    <span className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs">
                      {entry.action}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-600">
                    {entry.resourceType}:{entry.resourceId.slice(0, 8)}…
                  </td>
                  <td className="px-3 py-2 text-gray-600">
                    {entry.actorUserId ? `${entry.actorUserId.slice(0, 8)}…` : '—'}
                    <span className="ms-1 text-gray-400">({entry.actorRole})</span>
                  </td>
                  <td className="max-w-xs truncate px-3 py-2 text-gray-400">
                    {entry.metadata ? JSON.stringify(entry.metadata) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
