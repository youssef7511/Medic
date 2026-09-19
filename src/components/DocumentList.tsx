import { Download, FileText } from 'lucide-react';

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
    return <div className="medic-panel p-10 text-center"><FileText className="mx-auto h-10 w-10 text-slate-300" /><p className="mt-4 text-sm font-semibold text-navy-950">{ar ? 'لا توجد مستندات.' : 'Aucun document.'}</p></div>;
  }

  return (
    <ul className="medic-panel divide-y divide-slate-100">
      {documents.map((doc) => {
        const s = STATUS[doc.status];
        return (
          <li key={doc.id} className="flex flex-col justify-between gap-4 p-5 sm:flex-row sm:items-start">
            <div className="flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700"><FileText className="h-5 w-5" /></span>
              <div>
                <p className="text-sm font-bold text-navy-950">
                  {ar ? 'وصفة طبية' : 'Ordonnance'}
                  <span className="ms-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">v{doc.version}</span>
                </p>
                <p className="mt-1 text-sm text-slate-600">{doc.medicationSummary}</p>
                <p className="mt-1 text-xs text-slate-400">
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

            <div className="flex flex-row flex-wrap items-center gap-2 sm:flex-col sm:items-end">
              <span className={`rounded border px-2 py-0.5 text-xs font-medium ${s.cls}`}>
                {ar ? s.ar : s.fr}
              </span>
              <a
                href={`/api/documents/${doc.id}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-800 hover:bg-brand-100"
              >
                <Download className="h-3.5 w-3.5" />
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
