import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import {
  ArrowRight,
  CalendarCheck,
  CheckCircle2,
  MapPin,
  MessageSquareText,
  Search,
  ShieldCheck,
  Stethoscope,
  Users,
} from 'lucide-react';

export default async function LandingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  const ar = locale === 'ar';

  return (
    <>
      <section className="relative overflow-hidden bg-gradient-to-br from-white via-white to-brand-50">
        <div className="absolute -end-28 top-16 h-96 w-96 rounded-full bg-brand-100/70 blur-3xl" aria-hidden />
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:px-8 lg:py-24">
          <div className="relative">
            <div className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-800 shadow-sm">
              <ShieldCheck className="h-4 w-4" />
              {ar ? 'رعاية موثوقة، أقرب إليك' : 'Des soins de confiance, plus proches de vous'}
            </div>
            <h1 className="mt-6 max-w-3xl text-4xl font-extrabold tracking-tight text-navy-950 sm:text-5xl lg:text-6xl lg:leading-[1.08]">
              {t('landing.heroTitle')}
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
              {t('landing.heroSubtitle')}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/doctors"
                className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-600/20 transition hover:bg-brand-700"
              >
                {t('landing.ctaBrowse')}
                <ArrowRight className="h-4 w-4 rtl:rotate-180" />
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-navy-950 hover:border-brand-400 hover:bg-brand-50"
              >
                {t('common.login')}
              </Link>
            </div>
            <div className="mt-10 flex flex-wrap gap-x-6 gap-y-3 text-sm text-slate-500">
              <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" />{ar ? 'أطباء تم التحقق منهم' : 'Médecins vérifiés'}</span>
              <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" />{ar ? 'حجز آمن' : 'Réservation sécurisée'}</span>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-xl">
            <div className="medic-card relative overflow-hidden p-5 sm:p-7">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="medic-kicker">{ar ? 'موعدك القادم' : 'Votre prochain rendez-vous'}</p>
                  <h2 className="mt-2 text-xl font-bold text-navy-950">{ar ? 'د. ليلى بن علي' : 'Dr Leïla Ben Ali'}</h2>
                  <p className="mt-1 text-sm text-slate-500">{ar ? 'طب عام' : 'Médecine générale'}</p>
                </div>
                <div className="grid h-16 w-16 place-items-center rounded-2xl bg-brand-100 text-brand-700">
                  <Stethoscope className="h-8 w-8" />
                </div>
              </div>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-slate-50 p-4">
                  <CalendarCheck className="h-5 w-5 text-brand-600" />
                  <p className="mt-3 text-sm font-semibold text-navy-950">{ar ? 'الأربعاء، 23 أبريل' : 'Mercredi 23 avril'}</p>
                  <p className="mt-1 text-xs text-slate-500">14:30 – 15:00</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <MapPin className="h-5 w-5 text-brand-600" />
                  <p className="mt-3 text-sm font-semibold text-navy-950">Clinique Les Oliviers</p>
                  <p className="mt-1 text-xs text-slate-500">Tunis</p>
                </div>
              </div>
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
                {ar ? 'تم تأكيد الموعد' : 'Rendez-vous confirmé'}
              </div>
            </div>
            <div className="absolute -bottom-5 -start-5 hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-card sm:flex sm:items-center sm:gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-600"><MessageSquareText className="h-5 w-5" /></div>
              <div><p className="text-sm font-semibold text-navy-950">{ar ? 'فريقك قريب منك' : 'Votre équipe à vos côtés'}</p><p className="text-xs text-slate-500">{ar ? 'رسائل آمنة' : 'Messagerie sécurisée'}</p></div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-slate-200 bg-slate-50">
        <div className="mx-auto grid max-w-7xl gap-4 px-4 py-8 sm:grid-cols-3 sm:px-6 lg:px-8">
          <Metric icon={Stethoscope} value="100 %" label={ar ? 'ملفات طبية تم التحقق منها' : 'Profils médicaux vérifiés'} />
          <Metric icon={CalendarCheck} value="24/7" label={ar ? 'حجز المواعيد' : 'Prise de rendez-vous'} />
          <Metric icon={Users} value="FR · AR" label={ar ? 'تجربة ثنائية اللغة' : 'Expérience bilingue'} />
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <p className="medic-kicker">{ar ? 'بسيط وآمن' : 'Simple et sécurisé'}</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-navy-950">{ar ? 'رعايتك الصحية في مكان واحد' : 'Votre parcours de soins, au même endroit'}</h2>
        </div>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          <Feature icon={Search} title={ar ? 'ابحث' : 'Trouvez'} text={ar ? 'اختر التخصص والمدينة والطبيب المناسب.' : 'Choisissez une spécialité, une ville et le bon médecin.'} />
          <Feature icon={CalendarCheck} title={ar ? 'احجز' : 'Réservez'} text={ar ? 'حدد موعدًا متاحًا في بضع خطوات.' : 'Sélectionnez un créneau disponible en quelques étapes.'} />
          <Feature icon={MessageSquareText} title={ar ? 'تابع' : 'Suivez'} text={ar ? 'إدارة المواعيد والوثائق والرسائل بأمان.' : 'Gérez rendez-vous, documents et messages en sécurité.'} />
        </div>
      </section>
    </>
  );
}

function Metric({ icon: Icon, value, label }: { icon: typeof Stethoscope; value: string; label: string }) {
  return <div className="flex items-center justify-center gap-4 rounded-2xl px-4 py-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-white text-brand-700 shadow-sm"><Icon className="h-5 w-5" /></span><div><p className="text-xl font-bold text-navy-950">{value}</p><p className="text-xs text-slate-500">{label}</p></div></div>;
}

function Feature({ icon: Icon, title, text }: { icon: typeof Search; title: string; text: string }) {
  return <div className="medic-card p-6"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-700"><Icon className="h-6 w-6" /></span><h3 className="mt-5 text-lg font-bold text-navy-950">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-500">{text}</p></div>;
}
