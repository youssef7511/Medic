import { Role } from '@prisma/client';
import { requireRole } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { listDocuments } from '@/lib/documents/prescriptions';
import { UploadDocumentForm } from '@/components/UploadDocumentForm';
import { DocumentList } from '@/components/DocumentList';
import { Link } from '@/i18n/navigation';
import { FileText, ArrowRight } from 'lucide-react';

export const dynamic = 'force-dynamic';
export default async function DocumentsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const ar = locale === 'ar';
  const actor = await requireRole(locale, [Role.PATIENT], `/${locale}/p/documents`);
  const links = await prisma.patientDoctorLink.findMany({ where: { patient: { userId: actor.userId }, status: 'ACTIVE' }, select: { id: true, doctorId: true, doctor: { select: { headline: true } } } });
  const groups = await Promise.all(links.map(async link => ({ link, documents: await listDocuments(actor, link.id, locale) })));
  return <section><p className="medic-kicker">{ar ? 'الملف الطبي' : 'Dossier médical'}</p><h1 className="medic-page-title mt-2">{ar ? 'مستنداتي' : 'Mes documents'}</h1><p className="medic-muted mt-2">{ar ? 'وصفاتك ومستنداتك الطبية، مرتبة حسب الطبيب.' : 'Vos prescriptions et documents médicaux, réunis par médecin.'}</p>
    <UploadDocumentForm locale={locale} doctors={links.map(link => ({ linkId: link.id, name: (link.doctor.headline as Record<string, string>)?.[locale] ?? '' }))} />
    <div className="mt-7 space-y-5">{groups.length === 0 ? <div className="medic-card p-10 text-center"><FileText className="mx-auto h-10 w-10 text-slate-300" /><p className="medic-muted mt-3">{ar ? 'لا توجد مستندات بعد.' : 'Aucun document pour le moment.'}</p></div> : groups.map(({ link, documents }) => <article key={link.id} className="medic-card overflow-hidden"><div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4"><h2 className="font-bold">{(link.doctor.headline as Record<string, string>)?.[locale] ?? ''}</h2><Link href={`/p/doctors/${link.doctorId}/documents`} className="flex items-center gap-2 text-xs font-semibold text-brand-700">{ar ? 'إدارة المشاركة' : 'Gérer le partage'}<ArrowRight className="h-4 w-4 rtl:rotate-180" /></Link></div><div className="p-4"><DocumentList locale={locale} documents={documents.map(doc => ({ ...doc, issuedAtIso: doc.issuedAt.toISOString() }))} /></div></article>)}</div>
  </section>;
}
