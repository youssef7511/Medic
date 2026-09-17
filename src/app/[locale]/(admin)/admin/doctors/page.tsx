import { notFound, redirect } from 'next/navigation';
import { getCurrentActor } from '@/lib/auth/session';
import { hasPermission } from '@/lib/rbac/guard';
import { prisma } from '@/lib/db';
import { VerifyDoctorButton } from './VerifyDoctorButton';

export const dynamic = 'force-dynamic';

/**
 * Doctor onboarding queue (§6, §10). Lists all doctors, grouped by
 * verification status. SUPER_ADMIN can verify licenses and publish.
 * SUPPORT_ADMIN can view but not act.
 *
 * §10: license verification is a MANUAL human gate — never automated.
 */
export default async function AdminDoctorsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const ar = locale === 'ar';

  const actor = await getCurrentActor();
  if (!actor) redirect(`/${locale}/login`);

  const canVerify = hasPermission(actor, 'doctor:verify_license');
  const canPublish = hasPermission(actor, 'doctor:publish');

  const doctors = await prisma.doctorProfile.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      user: {
        select: {
          email: true,
          status: true,
        },
      },
      specialty: {
        select: { name: true },
      },
    },
  });

  const pending = doctors.filter((d) => !d.isPublished);
  const published = doctors.filter((d) => d.isPublished);

  return (
    <section>
      <h1 className="mb-6 text-2xl font-bold">
        {ar ? 'إدارة الأطباء' : 'Gestion des médecins'}
      </h1>

      {/* Pending verification */}
      <h2 className="mb-3 text-lg font-semibold text-amber-700">
        {ar ? 'في انتظار التحقق' : 'En attente de vérification'}
        <span className="ms-2 text-sm font-normal text-gray-400">({pending.length})</span>
      </h2>

      {pending.length === 0 ? (
        <p className="mb-8 text-sm text-gray-500">
          {ar ? 'لا توجد طلبات معلقة.' : 'Aucune demande en attente.'}
        </p>
      ) : (
        <ul className="mb-8 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {pending.map((doc) => {
            const headline = (doc.headline as Record<string, string>)?.[locale] ?? '';
            const specialty = (doc.specialty.name as Record<string, string>)?.[locale] ?? '';
            return (
              <li key={doc.id} className="flex items-center justify-between gap-4 p-4">
                <div>
                  <p className="text-sm font-medium">{headline || doc.licenseNumber}</p>
                  <p className="text-xs text-gray-500">{doc.user.email}</p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    {specialty} · {ar ? 'رقم الترخيص' : 'Licence'}: {doc.licenseNumber}
                  </p>
                  <p className="text-xs text-gray-400">
                    {ar ? 'مسجّل منذ' : 'Inscrit le'}:{' '}
                    {doc.createdAt.toLocaleDateString(locale)}
                  </p>
                </div>
                {canVerify && (
                  <VerifyDoctorButton
                    doctorId={doc.id}
                    doctorName={headline || doc.licenseNumber}
                    isPublished={doc.isPublished}
                    canPublish={canPublish}
                    locale={locale}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Published */}
      <h2 className="mb-3 text-lg font-semibold text-green-700">
        {ar ? 'أطباء منشورون' : 'Médecins publiés'}
        <span className="ms-2 text-sm font-normal text-gray-400">({published.length})</span>
      </h2>

      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
        {published.map((doc) => {
          const headline = (doc.headline as Record<string, string>)?.[locale] ?? '';
          const specialty = (doc.specialty.name as Record<string, string>)?.[locale] ?? '';
          return (
            <li key={doc.id} className="flex items-center justify-between gap-4 p-4">
              <div>
                <p className="text-sm font-medium">{headline || doc.licenseNumber}</p>
                <p className="text-xs text-gray-500">{doc.user.email}</p>
                <p className="mt-0.5 text-xs text-gray-400">
                  {specialty} · {ar ? 'رقم الترخيص' : 'Licence'}: {doc.licenseNumber}
                </p>
              </div>
              <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700">
                {ar ? 'منشور' : 'Publié'}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
