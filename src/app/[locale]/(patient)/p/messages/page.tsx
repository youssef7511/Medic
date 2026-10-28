import { Role } from '@prisma/client';
import { requireRole } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { listPatientThreads } from '@/lib/messaging/threads';
import { PatientThreads } from '@/components/PatientThreads';

export const dynamic = 'force-dynamic';
export default async function MessagesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const actor = await requireRole(locale, [Role.PATIENT], `/${locale}/p/messages`);
  const [threads, links] = await Promise.all([
    listPatientThreads(actor, locale),
    prisma.patientDoctorLink.findMany({ where: { patient: { userId: actor.userId }, status: 'ACTIVE' }, select: { id: true, doctorId: true } }),
  ]);
  const doctorIds = Object.fromEntries(links.map(link => [link.id, link.doctorId]));
  return <section><p className="medic-kicker">{locale === 'ar' ? 'فريق الرعاية' : 'Votre équipe de soin'}</p><h1 className="medic-page-title mt-2">{locale === 'ar' ? 'الرسائل' : 'Messages'}</h1><p className="medic-muted mt-2">{locale === 'ar' ? 'محادثاتك مع أطبائك في مكان واحد.' : 'Toutes vos conversations avec vos médecins, au même endroit.'}</p><div className="medic-panel mt-7"><PatientThreads threads={threads} doctorIds={doctorIds} locale={locale} /></div></section>;
}
