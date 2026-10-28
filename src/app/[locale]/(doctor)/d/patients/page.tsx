import { Role } from '@prisma/client';
import { requireRole } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { Link } from '@/i18n/navigation';
import { Search, Users, ArrowRight } from 'lucide-react';

export const dynamic = 'force-dynamic';
export default async function PatientsPage({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<{ q?: string }>;
}) {
  const { locale } = await params;
  const { q = '' } = await searchParams;
  const ar = locale === 'ar';
  const actor = await requireRole(locale, [Role.DOCTOR, Role.DOCTOR_STAFF], `/${locale}/d/patients`);
  const links = await prisma.patientDoctorLink.findMany({
    where: { doctor: { userId: actor.userId }, status: 'ACTIVE', ...(q.trim() ? { patient: { OR: [
      { firstName: { contains: q.trim(), mode: 'insensitive' } },
      { lastName: { contains: q.trim(), mode: 'insensitive' } },
    ] } } : {}) },
    select: { id: true, patient: { select: { firstName: true, lastName: true } }, _count: { select: { appointments: true } } },
    orderBy: { patient: { lastName: 'asc' } }, take: 100,
  });
  return <section><p className="medic-kicker">{ar ? 'عيادتك' : 'Votre cabinet'}</p><h1 className="medic-page-title mt-2">{ar ? 'المرضى' : 'Patients'}</h1><p className="medic-muted mt-2">{ar ? 'الوصول إلى ملفات المرضى المرتبطين بعيادتك.' : 'Retrouvez les patients liés à votre cabinet et accédez à leur dossier.'}</p>
    <form className="medic-card mt-7 flex max-w-lg items-center gap-3 px-4 py-2"><Search className="h-5 w-5 text-slate-400" /><input name="q" defaultValue={q} aria-label={ar ? 'البحث عن مريض' : 'Rechercher un patient'} placeholder={ar ? 'اسم المريض…' : 'Nom ou prénom du patient…'} className="h-10 min-w-0 flex-1 bg-transparent text-sm focus:ring-0" /><button type="submit" className="rounded-lg bg-navy-900 px-4 py-2 text-xs font-semibold text-white">{ar ? 'بحث' : 'Rechercher'}</button></form>
    <div className="medic-panel mt-5">{links.length === 0 ? <div className="p-10 text-center"><Users className="mx-auto h-10 w-10 text-slate-300" /><p className="medic-muted mt-3">{ar ? 'لم يتم العثور على مرضى.' : 'Aucun patient trouvé.'}</p></div> : <ul className="divide-y divide-slate-100">{links.map(link => <li key={link.id}><Link href={`/d/patients/${link.id}`} className="flex items-center gap-4 px-5 py-5 hover:bg-sky-50/50"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-sky-100 text-sm font-bold text-sky-800">{link.patient.firstName[0]}{link.patient.lastName[0]}</span><div className="min-w-0 flex-1"><p className="truncate font-bold">{link.patient.firstName} {link.patient.lastName}</p><p className="mt-1 text-xs text-slate-500">{link._count.appointments} {ar ? 'موعد' : 'rendez-vous'}</p></div><span className="hidden text-xs font-semibold text-sky-700 sm:block">{ar ? 'عرض الملف' : 'Ouvrir le dossier'}</span><ArrowRight className="h-4 w-4 text-sky-700 rtl:rotate-180" /></Link></li>)}</ul>}</div>
    {links.length === 100 && <p className="medic-muted mt-3">{ar ? 'اعرض بحثًا أدق للوصول إلى مرضى آخرين.' : 'Les 100 premiers résultats sont affichés. Affinez votre recherche pour retrouver un patient.'}</p>}
  </section>;
}
