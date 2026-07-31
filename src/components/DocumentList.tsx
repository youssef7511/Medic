import { FileText } from 'lucide-react';

export interface DocumentRow {
  id: string;
  type: string;
  status: 'ACTIVE' | 'SUPERSEDED' | 'REVOKED';
  version: number;
  issuedAtIso: string;
  medicationSummary: string;
  revokeReason: string | null;
}

const STATUS = {
  ACTIVE: { fr: 'Active', ar: 'سارية', cls: 'bg-green-50 text-green-800 border-green-200' },
  SUPERSEDED: { fr: 'Remplacée', ar: 'مُستبدلة', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  REVOKED: { fr: 'Annulée', ar: 'ملغاة', cls: 'bg-red-50 text-red-800 border-red-200' },
} as const;

/**
 * Read-only document timeline, shared by the doctor and patient views. The
 * download link points at the authorized `/api/documents/[id]` route — never a
 * storage URL. `actions` lets the doctor view inject a revoke control per row.
 */
export function DocumentList({
  documents,
  locale,
  actions,
}: {
  documents: DocumentRow[];
  locale: string;
  actions?: (doc: DocumentRow) => React.ReactNode;
}) {
  const ar = locale === 'ar';

  if (documents.length === 0) {
    return <p className="text-sm text-gray-500">{ar ? 'لا توجد مستندات.' : 'Aucun document.'}</p>;
  }

  return (
    <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
      {documents.map((doc) => {
        const s = STATUS[doc.status];
        return (
          <li key={doc.id} className="flex items-start justify-between gap-4 p-4">
            <div className="flex items-start gap-3">
              <FileText className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
              <div>
                <p className="text-sm font-medium">
                  {ar ? 'وصفة طبية' : 'Ordonnance'}
                  <span className="ms-2 text-xs text-gray-400">v{doc.version}</span>
                </p>
                <p className="text-sm text-gray-600">{doc.medicationSummary}</p>
                <p className="mt-0.5 text-xs text-gray-400">
                  {new Date(doc.issuedAtIso).toLocaleDateString(locale)}
                </p>
                {doc.status === 'REVOKED' && doc.revokeReason && (
                  <p className="mt-1 text-xs italic text-red-700">
                    {ar ? 'سبب الإلغاء: ' : 'Motif : '}
                    {doc.revokeReason}
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-col items-end gap-2">
              <span className={`rounded border px-2 py-0.5 text-xs font-medium ${s.cls}`}>
                {ar ? s.ar : s.fr}
              </span>
              <a
                href={`/api/documents/${doc.id}`}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-brand-600 hover:underline"
              >
                {ar ? 'تنزيل' : 'Télécharger'}
              </a>
              {actions?.(doc)}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
