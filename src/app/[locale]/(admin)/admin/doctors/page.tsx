import { redirect } from 'next/navigation';
import { getCurrentActor } from '@/lib/auth/session';
import { hasPermission } from '@/lib/rbac/guard';
import { prisma } from '@/lib/db';
import { VerifyDoctorButton } from './VerifyDoctorButton';
import { CheckCircle2, FileCheck2, Stethoscope } from 'lucide-react';

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
      <div><p className="medic-kicker">{ar ? 'التحقق والنشر' : 'Vérification et publication'}</p><h1 className="medic-page-title mt-2">{ar ? 'إدارة الأطباء' : 'Gestion des médecins'}</h1><p className="mt-2 text-sm text-slate-500">{ar ? 'راجع الترخيص قبل نشر أي ملف طبي.' : 'Contrôlez les licences avant de publier un profil médical.'}</p></div>

      {/* Pending verification */}
      <h2 className="mb-3 mt-8 flex items-center gap-2 text-lg font-bold text-navy-950"><FileCheck2 className="h-5 w-5 text-amber-600" />
        {ar ? 'في انتظار التحقق' : 'En attente de vérification'}
        <span className="ms-2 text-sm font-normal text-gray-400">({pending.length})</span>
      </h2>

      {pending.length === 0 ? (
        <div className="medic-panel mb-8 p-8 text-center"><CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" /><p className="mt-3 text-sm text-slate-500">
          {ar ? 'لا توجد طلبات معلقة.' : 'Aucune demande en attente.'}
        </p></div>
      ) : (
        <ul className="medic-panel mb-8 divide-y divide-slate-100">
          {pending.map((doc) => {
            const headline = (doc.headline as Record<string, string>)?.[locale] ?? '';
            const specialty = (doc.specialty.name as Record<string, string>)?.[locale] ?? '';
            return (
              <li key={doc.id} className="flex flex-col justify-between gap-4 p-5 sm:flex-row sm:items-center">
                <div className="flex items-start gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-700"><Stethoscope className="h-5 w-5" /></span><div>
                  <p className="text-sm font-bold text-navy-950">{headline || doc.licenseNumber}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{doc.user.email}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {specialty} · {ar ? 'رقم الترخيص' : 'Licence'}: {doc.licenseNumber}
                  </p>
                  <p className="text-xs text-slate-400">
                    {ar ? 'مسجّل منذ' : 'Inscrit le'}:{' '}
                    {doc.createdAt.toLocaleDateString(locale)}
                  </p>
                  <p className={`mt-2 text-xs font-semibold ${doc.licenseVerifiedAt ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {doc.licenseVerifiedAt
                      ? (ar ? 'تم التحقق من الترخيص — جاهز للنشر' : 'Licence vérifiée — prêt à publier')
                      : (ar ? 'التحقق من الترخيص مطلوب' : 'Vérification de licence requise')}
                  </p>
                </div></div>
                {canVerify && (
                  <VerifyDoctorButton
                    doctorId={doc.id}
                    isPublished={doc.isPublished}
                    licenseVerified={Boolean(doc.licenseVerifiedAt)}
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
      <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-navy-950"><CheckCircle2 className="h-5 w-5 text-emerald-600" />
        {ar ? 'أطباء منشورون' : 'Médecins publiés'}
        <span className="ms-2 text-sm font-normal text-gray-400">({published.length})</span>
      </h2>

      <ul className="medic-panel divide-y divide-slate-100">
        {published.map((doc) => {
          const headline = (doc.headline as Record<string, string>)?.[locale] ?? '';
          const specialty = (doc.specialty.name as Record<string, string>)?.[locale] ?? '';
          return (
          <li key={doc.id} className="flex items-center justify-between gap-4 p-5">
              <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><Stethoscope className="h-5 w-5" /></span><div>
                <p className="text-sm font-bold text-navy-950">{headline || doc.licenseNumber}</p>
                <p className="text-xs text-slate-500">{doc.user.email}</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {specialty} · {ar ? 'رقم الترخيص' : 'Licence'}: {doc.licenseNumber}
                </p>
              </div></div>
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                {ar ? 'منشور' : 'Publié'}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
