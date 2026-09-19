import { redirect } from 'next/navigation';
import { getCurrentActor } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { decryptText } from '@/lib/crypto/envelope';
import { AllergyForm } from './AllergyForm';
import { AlertTriangle, ShieldCheck } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AllergiesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const ar = locale === 'ar';

  const actor = await getCurrentActor();
  if (!actor) redirect(`/${locale}/login`);

  const profile = await prisma.patientProfile.findUnique({
    where: { userId: actor.userId },
    select: { allergiesEnc: true, allergiesAffirmedNone: true },
  });

  const initialText = profile?.allergiesEnc ? await decryptText(profile.allergiesEnc) : '';

  return (
    <section className="max-w-3xl">
      <p className="medic-kicker">{ar ? 'سلامة الوصفات' : 'Sécurité des prescriptions'}</p><h1 className="medic-page-title mt-2">{ar ? 'الحساسيات الدوائية' : 'Allergies médicamenteuses'}</h1>
      <p className="mt-2 text-sm text-slate-500">
        {ar
          ? 'تظهر هذه المعلومة لطبيبك عند وصف الدواء.'
          : 'Cette information est affichée à votre médecin lors de la prescription.'}
      </p>
      <div className="mt-6 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" /><div><p className="text-sm font-semibold text-amber-900">{ar ? 'معلومة مهمة لفريق الرعاية' : 'Information importante pour votre équipe'}</p><p className="mt-1 text-xs leading-5 text-amber-700">{ar ? 'حدّث هذه المعلومات عند ظهور حساسية جديدة.' : 'Mettez cette information à jour dès qu’une nouvelle allergie est identifiée.'}</p></div></div>
      <div className="medic-panel mt-5 p-5 sm:p-6"><div className="mb-5 flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700"><ShieldCheck className="h-5 w-5" /></span><h2 className="font-bold text-navy-950">{ar ? 'حالتي الحالية' : 'Mon statut actuel'}</h2></div><AllergyForm initialText={initialText} initialAffirmedNone={profile?.allergiesAffirmedNone ?? false} /></div>
    </section>
  );
}
