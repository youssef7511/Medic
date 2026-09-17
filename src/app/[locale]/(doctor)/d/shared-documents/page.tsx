import { notFound, redirect } from 'next/navigation';
import { getCurrentActor } from '@/lib/auth/session';
import { hasPermission } from '@/lib/rbac/guard';
import { listSharedDocuments } from '@/lib/documents/sharing';
import { FileText } from 'lucide-react';

export const dynamic = 'force-dynamic';

/**
 * Doctor's "shared with me" page — documents shared by patients across all
 * relationships (§4c). This is separate from the per-patient timeline because
 * shared docs may come from patients the doctor has no link with.
 *
 * §5: only DOCTOR can see this page — DOCTOR_STAFF lacks `document:read`.
 */
export default async function SharedDocumentsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const ar = locale === 'ar';

  const actor = await getCurrentActor();
  if (!actor) redirect(`/${locale}/login`);
  if (!hasPermission(actor, 'document:read')) notFound();

  const docs = await listSharedDocuments(actor, locale);

  return (
    <section>
      <h1 className="mb-2 text-2xl font-bold">
        {ar ? 'مستندات مشتركة' : 'Documents partagés'}
      </h1>
      <p className="mb-6 text-sm text-gray-500">
        {ar
          ? 'مستندات شاركها المرضى معك.'
          : 'Documents que des patients ont partagés avec vous.'}
      </p>

      {docs.length === 0 ? (
        <p className="text-sm text-gray-500">
          {ar ? 'لا توجد مستندات مشتركة.' : 'Aucun document partagé.'}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {docs.map((doc) => (
            <li key={doc.id} className="flex items-start justify-between gap-4 p-4">
              <div className="flex items-start gap-3">
                <FileText className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
                <div>
                  <p className="text-sm font-medium">
                    {ar ? 'وصفة طبية' : 'Ordonnance'}
                    <span className="ms-2 text-xs text-gray-400">v{doc.version}</span>
                  </p>
                  {doc.medicationSummary && (
                    <p className="text-sm text-gray-600">{doc.medicationSummary}</p>
                  )}
                  <p className="mt-0.5 text-xs text-gray-400">
                    {ar ? 'شاركه' : 'Partagé par'}{' '}
                    <span className="font-medium text-gray-600">{doc.sharedByPatientName}</span>
                    {' · '}
                    {doc.sharedAt.toLocaleDateString(locale)}
                  </p>
                </div>
              </div>
              <a
                href={`/api/documents/${doc.id}`}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-brand-600 hover:underline"
              >
                {ar ? 'تنزيل' : 'Télécharger'}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
