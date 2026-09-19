import { EnrollMfaForm } from './EnrollMfaForm';
import { Brand } from '@/components/Brand';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { ShieldCheck } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function EnrollMfaPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const ar = locale === 'ar';
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex h-[72px] max-w-6xl items-center justify-between px-4 sm:px-6"><Brand /><LocaleSwitcher /></div></header>
      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-16">
        <div className="medic-card overflow-hidden">
          <div className="border-b border-slate-200 bg-gradient-to-br from-brand-50 to-white p-6 sm:p-8">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white text-brand-700 shadow-sm"><ShieldCheck className="h-6 w-6" /></span>
            <p className="medic-kicker mt-5">{ar ? 'أمان الحساب' : 'Sécurité du compte'}</p>
            <h1 className="mt-2 text-2xl font-bold text-navy-950 sm:text-3xl">{ar ? 'تفعيل المصادقة الثنائية' : 'Activer l’authentification à deux facteurs'}</h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">{ar ? 'أضف طبقة حماية إضافية إلى حسابك المهني.' : 'Ajoutez une couche de protection supplémentaire à votre compte professionnel.'}</p>
          </div>
          <div className="p-6 sm:p-8">
            <EnrollMfaForm />
          </div>
        </div>
        <p className="mt-5 text-center text-xs text-slate-500">{ar ? 'لن تطلب Medic أبداً رمز المصادقة عبر الهاتف.' : 'Medic ne vous demandera jamais votre code de vérification par téléphone.'}</p>
      </main>
    </div>
  );
}
