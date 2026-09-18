import { notFound, redirect } from 'next/navigation';
import { getCurrentActor } from '@/lib/auth/session';
import { getBreakGlassSnapshot } from '@/lib/break-glass/access';
import { ResourceNotFoundError } from '@/lib/rbac/guard';
import { revokeBreakGlassAction } from '../actions';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

export default async function BreakGlassSnapshotPage({
  params,
}: {
  params: Promise<{ locale: string; grantId: string }>;
}) {
  const { locale, grantId } = await params;
  const ar = locale === 'ar';
  const actor = await getCurrentActor();
  if (!actor) redirect(`/${locale}/login`);

  let snapshot;
  try {
    snapshot = await getBreakGlassSnapshot(actor, grantId);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) notFound();
    throw error;
  }

  return (
    <section className="space-y-6">
      <div className="sticky top-0 z-10 rounded-lg border-2 border-red-600 bg-red-50 p-4 text-red-950 shadow">
        <p className="font-bold">{ar ? 'وضع الوصول الطارئ نشط' : 'MODE BREAK-GLASS ACTIF'}</p>
        <p className="text-sm">{ar ? 'ينتهي في' : 'Expire le'} {snapshot.grant.expiresAt.toLocaleString(locale)}</p>
        <p className="mt-1 text-sm"><strong>{ar ? 'السبب:' : 'Justification :'} </strong>{snapshot.grant.reason}</p>
        <form action={revokeBreakGlassAction} className="mt-3">
          <input type="hidden" name="grantId" value={snapshot.grant.id} />
          <Button type="submit" variant="destructive" size="sm">{ar ? 'إنهاء الوصول الآن' : 'Révoquer maintenant'}</Button>
        </form>
      </div>

      <div className="rounded border bg-white p-4">
        <h1 className="text-xl font-bold">{snapshot.patient.name}</h1>
        <p className="text-sm text-gray-500">{snapshot.patient.email ?? '—'} · {snapshot.patient.id}</p>
        <p className="mt-3 text-sm"><strong>{ar ? 'الحساسية:' : 'Allergies :'} </strong>{snapshot.patient.allergies ?? (snapshot.patient.allergiesAffirmedNone ? (ar ? 'لا توجد حساسية معروفة' : 'Aucune allergie connue') : (ar ? 'غير مسجلة' : 'Non renseignées'))}</p>
      </div>

      {snapshot.links.map((link, index) => {
        const headline = link.doctorHeadline as Record<string, string> | null;
        return (
          <div key={index} className="rounded border border-red-200 bg-white p-4">
            <h2 className="font-semibold">{headline?.[locale] ?? headline?.fr ?? (ar ? 'طبيب' : 'Médecin')}</h2>
            <h3 className="mb-2 mt-4 text-sm font-semibold uppercase text-gray-500">{ar ? 'الملاحظات' : 'Notes'}</h3>
            {link.notes.map((note) => <article key={note.id} className="mb-2 whitespace-pre-wrap rounded bg-gray-50 p-3 text-sm">{note.content}</article>)}
            <h3 className="mb-2 mt-4 text-sm font-semibold uppercase text-gray-500">{ar ? 'الرسائل' : 'Messages'}</h3>
            {link.threads.flatMap((thread) => thread.messages).map((message) => <article key={message.id} className="mb-2 whitespace-pre-wrap rounded bg-gray-50 p-3 text-sm">{message.body}</article>)}
            <h3 className="mb-2 mt-4 text-sm font-semibold uppercase text-gray-500">{ar ? 'الوثائق' : 'Documents'}</h3>
            {link.documents.map((document) => <p key={document.id} className="text-sm">{document.type} · {document.status} · {document.issuedAt.toLocaleDateString(locale)}</p>)}
          </div>
        );
      })}
    </section>
  );
}
