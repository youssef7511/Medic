import { notFound, redirect } from 'next/navigation';
import { NoteStatus } from '@prisma/client';
import { getCurrentActor } from '@/lib/auth/session';
import { hasPermission, requireLink, ResourceNotFoundError } from '@/lib/rbac/guard';
import { prisma } from '@/lib/db';
import { readAllergyState } from '@/lib/clinical/allergies';
import { audit } from '@/lib/audit';
import { AllergyPanel } from '@/components/AllergyPanel';
import { AppointmentStatusBadge } from '@/components/AppointmentStatusBadge';
import { DocumentList, type DocumentRow } from '@/components/DocumentList';
import { Link } from '@/i18n/navigation';
import { CalendarDays, FileText, NotebookPen, Phone, Pill, UserRound } from 'lucide-react';

export const dynamic = 'force-dynamic';

/**
 * Patient clinical overview — the "be well-informative" backbone (§3.1).
 *
 * Shows structure, not clinical content: note bodies and document contents stay
 * on their own already-audited pages; this overview shows counts, dates, and
 * links. One `patient.overview_read` audit event fires when the page opens.
 *
 * Allergies are the one clinical thing decrypted inline, because surfacing them
 * is the whole point (§3.1).
 *
 * DOCTOR_STAFF gets a reduced view — demographics + appointments only. Staff
 * reach patients via the calendar (§5) and never see clinical content. Same
 * URL, content gated by permission.
 */

function ageFromDob(dob: Date): number {
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const hadBirthday =
    now.getMonth() > dob.getMonth() ||
    (now.getMonth() === dob.getMonth() && now.getDate() >= dob.getDate());
  if (!hadBirthday) age--;
  return age;
}

export default async function DoctorPatientPage({
  params,
}: {
  params: Promise<{ linkId: string; locale: string }>;
}) {
  const { linkId, locale } = await params;
  const ar = locale === 'ar';

  const actor = await getCurrentActor();
  if (!actor) redirect(`/${locale}/login`);

  // Gate with calendar:read — both DOCTOR and DOCTOR_STAFF have it (§5).
  // This lets staff reach the overview; clinical sections are gated separately.
  let link;
  try {
    link = await requireLink(actor, linkId, 'calendar:read');
  } catch (e) {
    if (e instanceof ResourceNotFoundError) notFound();
    throw e;
  }

  const isDoctor = hasPermission(actor, 'note:read');

  // ── Data fetching ───────────────────────────────────────────────────────
  const [patient, allergyState, upcomingAppts, pastAppts, recentNotes, recentDocs, totalNotes, totalDocs] =
    await Promise.all([
      prisma.patientProfile.findUniqueOrThrow({
        where: { id: link.patientId },
        select: {
          firstName: true,
          lastName: true,
          dateOfBirth: true,
          sex: true,
          phone: true,
        },
      }),
      readAllergyState(link.patientId),
      prisma.appointment.findMany({
        where: { linkId, startAt: { gte: new Date() } },
        orderBy: { startAt: 'asc' },
        take: 3,
        select: { id: true, startAt: true, endAt: true, status: true, clinic: { select: { name: true } } },
      }),
      prisma.appointment.findMany({
        where: { linkId, startAt: { lt: new Date() } },
        orderBy: { startAt: 'desc' },
        take: 3,
        select: { id: true, startAt: true, endAt: true, status: true, clinic: { select: { name: true } } },
      }),
      prisma.consultationNote.findMany({
        where: { linkId, ...(isDoctor ? { authorUserId: actor.userId } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 3,
        select: { id: true, createdAt: true, updatedAt: true, status: true },
      }),
      prisma.document.findMany({
        where: { linkId },
        orderBy: { issuedAt: 'desc' },
        take: 3,
        select: {
          id: true, type: true, status: true, version: true, issuedAt: true, revokeReason: true,
        },
      }),
      prisma.consultationNote.count({ where: { linkId, ...(isDoctor ? { authorUserId: actor.userId } : {}) } }),
      prisma.document.count({ where: { linkId } }),
    ]);

  // One audit event per overview open (§10). Metadata carries counts so the
  // audit trail shows what was on-screen without re-querying.
  await audit(prisma, {
    actorUserId: actor.userId,
    actorRole: isDoctor ? 'DOCTOR' : 'DOCTOR_STAFF',
    action: 'patient.overview_read',
    resourceType: 'PatientDoctorLink',
    resourceId: linkId,
    patientId: link.patientId,
    metadata: { noteCount: totalNotes, documentCount: totalDocs },
  });

  // ── Derived data ────────────────────────────────────────────────────────
  const age = ageFromDob(patient.dateOfBirth);

  const sexLabels: Record<string, string> = {
    FEMALE: ar ? 'أنثى' : 'Femme',
    MALE: ar ? 'ذكر' : 'Homme',
    UNSPECIFIED: ar ? 'غير محدد' : 'Non spécifié',
  };

  const docRows: DocumentRow[] = recentDocs.map((d) => ({
    id: d.id,
    type: d.type,
    status: d.status,
    version: d.version,
    issuedAtIso: d.issuedAt.toISOString(),
    medicationSummary: '', // intentionally empty — overview doesn't decrypt clinical content
    revokeReason: d.revokeReason,
  }));

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <section className="max-w-5xl space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div><p className="medic-kicker">{ar ? 'ملف المريض' : 'Dossier patient'}</p><div className="mt-3 flex items-center gap-4"><span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-700"><UserRound className="h-7 w-7" /></span><div><h1 className="medic-page-title">{patient.firstName} {patient.lastName}</h1><p className="mt-1 text-xs text-slate-400">{ar ? 'رابط الرعاية' : 'Lien de soin'} · {linkId.slice(0, 10)}…</p></div></div></div>

      {/* ── Demographics ────────────────────────────────────────────────── */}
      <section className="medic-panel p-5">
        <h2 className="mb-4 text-sm font-bold text-navy-950">
          {ar ? 'المعلومات الأساسية' : 'Informations patient'}
        </h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-slate-500">{ar ? 'تاريخ الميلاد' : 'Date de naissance'}</dt>
            <dd className="mt-0.5 font-medium">
              {patient.dateOfBirth.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })}
              <span className="ms-1 text-slate-400">({age} {ar ? 'سنة' : 'ans'})</span>
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">{ar ? 'الجنس' : 'Sexe'}</dt>
            <dd className="mt-0.5 font-medium">{sexLabels[patient.sex]}</dd>
          </div>
          <div>
            <dt className="text-slate-500">{ar ? 'الهاتف' : 'Téléphone'}</dt>
            <dd className="mt-0.5 flex items-center gap-1.5 font-medium"><Phone className="h-3.5 w-3.5 text-brand-600" />{patient.phone}</dd>
          </div>
        </dl>
      </section>

      {/* ── Allergies — decrypted inline (§3.1). The one clinical thing
           shown on the overview, because surfacing them is the whole point. */}
      {isDoctor && (
        <section>
          <AllergyPanel state={allergyState} locale={locale} />
        </section>
      )}

      {/* ── Appointments ────────────────────────────────────────────────── */}
      <section className="medic-panel p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-bold text-navy-950"><CalendarDays className="h-4 w-4 text-brand-600" />
            {ar ? 'المواعيد' : 'Rendez-vous'}
          </h2>
          <Link
            href="/d/calendar"
            className="text-xs text-brand-600 hover:underline"
          >
            {ar ? 'التقويم' : 'Agenda'}
          </Link>
        </div>

        {upcomingAppts.length === 0 && pastAppts.length === 0 && (
          <p className="text-sm text-gray-500">{ar ? 'لا توجد مواعيد.' : 'Aucun rendez-vous.'}</p>
        )}

        {upcomingAppts.length > 0 && (
          <>
            <h3 className="mb-2 text-xs font-medium text-gray-500">
              {ar ? 'المواعيد القادمة' : 'À venir'}
            </h3>
            <ul className="mb-4 divide-y divide-gray-100">
              {upcomingAppts.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                  <div>
                    <p className="text-sm font-medium">
                      {a.startAt.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}
                      <span className="ms-2 text-gray-500">
                        {a.startAt.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                        {' – '}
                        {a.endAt.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </p>
                    <p className="text-xs text-gray-400">{a.clinic.name}</p>
                  </div>
                  <AppointmentStatusBadge status={a.status} locale={locale} />
                </li>
              ))}
            </ul>
          </>
        )}

        {pastAppts.length > 0 && (
          <>
            <h3 className="mb-2 text-xs font-medium text-gray-500">
              {ar ? 'المواعيد السابقة' : 'Passés'}
            </h3>
            <ul className="divide-y divide-gray-100">
              {pastAppts.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                  <div>
                    <p className="text-sm font-medium">
                      {a.startAt.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}
                      <span className="ms-2 text-gray-500">
                        {a.startAt.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                        {' – '}
                        {a.endAt.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </p>
                    <p className="text-xs text-gray-400">{a.clinic.name}</p>
                  </div>
                  <AppointmentStatusBadge status={a.status} locale={locale} />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* ── Clinical sections — DOCTOR only (§5). Staff never sees these. */}
      {isDoctor && (
        <>
          {/* ── Recent notes ─────────────────────────────────────────────── */}
          <section className="medic-panel p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-bold text-navy-950"><NotebookPen className="h-4 w-4 text-brand-600" />
                {ar ? 'الملاحظات السريرية' : 'Notes cliniques'}
                <span className="ms-2 text-xs font-normal text-gray-400">
                  {totalNotes > 0
                    ? ar
                      ? `(${totalNotes})`
                      : `(${totalNotes})`
                    : ''}
                </span>
              </h2>
              <Link
                href={`/d/patients/${linkId}/notes`}
                className="text-xs text-brand-600 hover:underline"
              >
                {recentNotes.length > 0
                  ? ar
                    ? 'عرض الكل'
                    : 'Voir tout'
                  : ar
                    ? 'كتابة ملاحظة'
                    : 'Nouvelle note'}
              </Link>
            </div>

            {recentNotes.length === 0 ? (
              <p className="text-sm text-gray-500">
                {ar ? 'لا توجد ملاحظات.' : 'Aucune note.'}
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {recentNotes.map((n) => (
                  <li key={n.id} className="flex items-center justify-between py-2">
                    <div>
                      <p className="text-sm font-medium">
                        {n.createdAt.toLocaleDateString(locale, {
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                        })}
                      </p>
                      <p className="text-xs text-gray-400">
                        {ar ? 'آخر تحديث' : 'Dernière modification'}:{' '}
                        {n.updatedAt.toLocaleDateString(locale, {
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                        })}
                      </p>
                    </div>
                    {n.status === NoteStatus.RETRACTED && (
                      <span className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-xs text-red-700">
                        {ar ? 'تم سحبها' : 'Rétractée'}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── Recent documents ─────────────────────────────────────────── */}
          <section className="medic-panel p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-bold text-navy-950"><FileText className="h-4 w-4 text-brand-600" />
                {ar ? 'المستندات' : 'Documents'}
                <span className="ms-2 text-xs font-normal text-gray-400">
                  {totalDocs > 0 ? `(${totalDocs})` : ''}
                </span>
              </h2>
              <Link
                href={`/d/patients/${linkId}/documents`}
                className="text-xs text-brand-600 hover:underline"
              >
                {recentDocs.length > 0
                  ? ar
                    ? 'عرض الكل'
                    : 'Voir tout'
                  : ar
                    ? 'إصدار مستند'
                    : 'Nouvel document'}
              </Link>
            </div>

            <DocumentList documents={docRows} locale={locale} />
          </section>

          {/* ── Quick actions ────────────────────────────────────────────── */}
          <section className="flex flex-wrap gap-3 rounded-2xl bg-slate-100 p-3">
            <Link
              href={`/d/patients/${linkId}/prescribe`}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
            >
              <Pill className="h-4 w-4" />
              {ar ? 'وصفة جديدة' : 'Nouvelle ordonnance'}
            </Link>
            <Link
              href={`/d/patients/${linkId}/notes`}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <NotebookPen className="h-4 w-4" />
              {ar ? 'الملاحظات السريرية' : 'Notes cliniques'}
            </Link>
            <Link
              href={`/d/patients/${linkId}/documents`}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <FileText className="h-4 w-4" />
              {ar ? 'المستندات' : 'Documents'}
            </Link>
          </section>
        </>
      )}
    </section>
  );
}
