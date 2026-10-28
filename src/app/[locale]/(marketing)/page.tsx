import Image from 'next/image';
import { setRequestLocale } from 'next-intl/server';
import { ArrowRight, Baby, CalendarDays, ChevronDown, FileText, HeartPulse, MapPin, MessageCircle, Search, ScanFace, Stethoscope, UserRound } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { getPublicDirectory, publicClinicCity, publicText, type PublicDoctor } from '@/lib/doctors/public-directory';

export const dynamic = 'force-dynamic';
const patientHref = (path: string) => `/login/patient?next=${encodeURIComponent(path)}`;
const specialtyOrder = ['general-medicine', 'cardiology', 'dermatology', 'pediatrics'];
const specialtyIcons: Record<string, typeof Stethoscope> = { 'general-medicine': Stethoscope, cardiology: HeartPulse, dermatology: ScanFace, pediatrics: Baby };

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const ar = locale === 'ar';
  const { doctors, specialties } = await getPublicDirectory();
  const sortedSpecialties = [...specialties].sort((a, b) => publicText(a.name, locale).localeCompare(publicText(b.name, locale), locale));
  const highlightedSpecialties = [...specialties].sort((a, b) => {
    const rank = (slug: string) => specialtyOrder.includes(slug) ? specialtyOrder.indexOf(slug) : specialtyOrder.length;
    return rank(a.slug) - rank(b.slug);
  }).slice(0, 4);
  const cities = [...new Set(doctors.flatMap(doctor => doctor.clinics.map(clinic => publicClinicCity(clinic.address))).filter(Boolean))].sort((a, b) => a.localeCompare(b, locale));
  const features = [
    { icon: CalendarDays, title: ar ? 'مواعيدي' : 'Mes rendez-vous', text: ar ? 'اعثر على مواعيدك ونظّم زياراتك بسهولة.' : 'Retrouvez et gérez facilement tous vos rendez-vous.', href: '/p/appointments' },
    { icon: FileText, title: ar ? 'وثائقي الطبية' : 'Mes documents', text: ar ? 'اعثر على وثائقك وشاركها مع طبيبك.' : 'Retrouvez vos documents médicaux et partagez-les avec votre médecin.', href: '/p/documents' },
    { icon: MessageCircle, title: ar ? 'رسائل مشفّرة' : 'Messages chiffrés', text: ar ? 'تواصل مع طبيبك بخصوصية تامة.' : 'Échangez avec votre médecin en toute confidentialité.', href: '/p/messages' },
  ];
  const steps = [
    { icon: Search, title: ar ? 'اعثر على طبيبك' : 'Trouvez votre médecin', text: ar ? 'ابحث حسب التخصص والمدينة.' : 'Recherchez par spécialité et par ville.' },
    { icon: CalendarDays, title: ar ? 'اختر موعدًا مناسبًا' : 'Choisissez un créneau', text: ar ? 'اطّلع على المواعيد المتاحة وأرسل طلبك ببضع نقرات.' : 'Consultez les disponibilités et demandez votre rendez-vous en quelques clics.' },
    { icon: FileText, title: ar ? 'تابع رعايتك الصحية' : 'Retrouvez votre suivi', text: ar ? 'مواعيدك ووثائقك ورسائلك في مكان واحد.' : 'Vos rendez-vous, vos documents et vos échanges, au même endroit.' },
  ];
  return <div className="editorial-landing">
    <section className="editorial-hero" aria-labelledby="landing-title">
      <div className="editorial-hero-photo"><Image src="/images/landing/consultation.webp" alt={ar ? 'طبيبة تستمع إلى مريض في عيادة مضيئة' : 'Une médecin à l’écoute de son patient dans un cabinet lumineux'} fill priority unoptimized sizes="100vw" className="editorial-consultation-photo" /></div>
      <div className="editorial-hero-content editorial-container">
        <p className="editorial-eyebrow">{ar ? 'مواعيد أكثر إنسانية، لصحة أفضل' : <>Des rendez-vous plus humains<br />pour une meilleure santé</>}</p>
        <h1 id="landing-title" className="editorial-title">{ar ? <>العناية بصحتك<br />تبدأ من هنا.</> : <>Prendre soin de<br />vous commence ici.</>}</h1>
        <p className="editorial-hero-subtitle">{ar ? 'أطباء يصغون إليك، ومتابعة صحية في متناولك.' : 'Des médecins à votre écoute, un suivi à portée de main.'}</p>
      </div>
    </section>
    <div className="editorial-container editorial-search-wrap">
      <form action={`/${locale}/doctors`} method="get" className="editorial-search" aria-label={ar ? 'البحث عن طبيب' : 'Rechercher un médecin'}>
        <div className="editorial-search-inner">
          <label className="editorial-search-field"><Stethoscope aria-hidden="true" /><span><span className="editorial-field-title">{ar ? 'التخصص' : 'Spécialité'}</span><select name="specialty" aria-label={ar ? 'التخصص' : 'Spécialité'} defaultValue=""><option value="">{ar ? 'كل التخصصات' : 'Toutes les spécialités'}</option>{sortedSpecialties.map(item => <option key={item.slug} value={item.slug}>{publicText(item.name, locale)}</option>)}</select></span><ChevronDown className="editorial-select-chevron" aria-hidden="true" /></label>
          <label className="editorial-search-field"><MapPin aria-hidden="true" /><span><span className="editorial-field-title">{ar ? 'المدينة' : 'Ville'}</span><select name="city" aria-label={ar ? 'المدينة' : 'Ville'} defaultValue=""><option value="">{ar ? 'كل المدن' : 'Toutes les villes'}</option>{cities.map(city => <option key={city} value={city}>{city}</option>)}</select></span><ChevronDown className="editorial-select-chevron" aria-hidden="true" /></label>
          <button type="submit" className="editorial-button editorial-search-button"><Search aria-hidden="true" />{ar ? 'ابحث' : 'Rechercher'}</button>
        </div>
      </form>
    </div>
    <div className="editorial-container editorial-content">
      <section className="editorial-specialties" aria-labelledby="specialties-title">
        <div className="editorial-section-label"><h2 id="specialties-title">{ar ? 'ابحث حسب التخصص' : 'Rechercher par spécialité'}</h2><Link href="/doctors" className="editorial-text-link">{ar ? 'كل التخصصات' : 'Voir toutes les spécialités'}<ArrowRight aria-hidden="true" /></Link></div>
        {highlightedSpecialties.length ? <div className="editorial-specialty-grid">{highlightedSpecialties.map(item => {
          const Icon = specialtyIcons[item.slug] ?? Stethoscope;
          return <Link key={item.slug} href={`/doctors?specialty=${encodeURIComponent(item.slug)}`} className={`editorial-specialty ${['cardiology', 'dermatology'].includes(item.slug) ? 'editorial-specialty-coral' : ''}`}><Icon aria-hidden="true" /><span>{publicText(item.name, locale)}</span><ArrowRight aria-hidden="true" className="editorial-specialty-arrow" /></Link>;
        })}</div> : <Link href="/doctors" className="editorial-text-link">{ar ? 'اكتشف دليل الأطباء' : 'Découvrir le répertoire des médecins'}<ArrowRight aria-hidden="true" /></Link>}
      </section>
      <section id="comment-ca-marche" className="editorial-steps" aria-labelledby="steps-title">
        <div className="editorial-section-heading"><h2 id="steps-title" className="editorial-title">{ar ? 'صحتك، بكل بساطة.' : 'Votre santé, simplement.'}</h2><p>{ar ? 'وصول أسهل إلى الطبيب المناسب، ومتابعة أبسط للعناية بصحتك كل يوم.' : 'Un accès plus simple aux bons médecins et un suivi facilité, pour prendre soin de vous au quotidien.'}</p></div>
        <ol className="editorial-step-grid">{steps.map(({ icon: Icon, title, text }, index) => <li key={title} className="editorial-step"><span className="editorial-icon-circle"><Icon aria-hidden="true" /></span><div><h3><span>{new Intl.NumberFormat(locale).format(index + 1)}.</span> {title}</h3><p>{text}</p></div>{index < 2 && <ArrowRight className="editorial-step-arrow" aria-hidden="true" />}</li>)}</ol>
      </section>
      <section id="medecins" className="editorial-care" aria-labelledby="care-title">
        <div className="editorial-section-heading"><h2 id="care-title" className="editorial-title">{ar ? 'إلى جانبك، في كل خطوة.' : 'À vos côtés, à chaque étape.'}</h2><p>{ar ? 'أطباء ملتزمون، وتنظيم أبسط، وأدوات تساعدك على متابعة رعايتك الصحية.' : 'Des médecins engagés, une organisation plus simple et des outils pensés pour vous accompagner durablement.'}</p></div>
        <div className="editorial-care-grid">
          <ul className="editorial-feature-list">{features.map(({ icon: Icon, title, text, href }) => <li key={href}><Link href={patientHref(href)} className="editorial-feature"><span className="editorial-icon-circle"><Icon aria-hidden="true" /></span><span><strong>{title}</strong><span>{text}</span></span><ArrowRight className="editorial-feature-arrow" aria-hidden="true" /></Link></li>)}</ul>
          <div className="editorial-doctor-grid">{doctors.length ? doctors.slice(0, 3).map(doctor => <LandingDoctorCard key={doctor.id} doctor={doctor} locale={locale} />) : <div className="editorial-doctors-empty"><Stethoscope aria-hidden="true" /><h3>{ar ? 'أطباء أقرب إليك' : 'Des médecins plus proches de vous'}</h3><p>{ar ? 'ستجد الملفات الطبية المنشورة هنا عند توفرها.' : 'Les profils de nos médecins seront présentés ici dès leur publication.'}</p><Link href="/doctors" className="editorial-text-link">{ar ? 'عرض الدليل' : 'Consulter le répertoire'}<ArrowRight aria-hidden="true" /></Link></div>}</div>
        </div>
        {doctors.length > 0 && <div className="editorial-directory-link"><Link href="/doctors" className="editorial-text-link">{ar ? 'عرض جميع الأطباء' : 'Voir tous les médecins'}<ArrowRight aria-hidden="true" /></Link></div>}
      </section>
      <section className="editorial-access" aria-labelledby="access-title">
        <div className="editorial-access-photo"><Image src="/images/landing/consultation.webp" alt="" fill unoptimized sizes="(max-width: 640px) 0px, 320px" className="editorial-consultation-photo" /></div>
        <div className="editorial-access-copy"><h2 id="access-title" className="editorial-title">{ar ? 'فضاء يناسب احتياجاتك.' : 'Un espace pour chaque besoin.'}</h2><p>{ar ? 'ادخل إلى فضائك لتبسيط تنظيم مواعيدك ومتابعتك الصحية.' : 'Accédez à votre espace Medic pour simplifier la gestion de vos rendez-vous et de votre suivi.'}</p></div>
        <div className="editorial-access-actions"><Link href="/login/patient" className="editorial-button"><UserRound aria-hidden="true" />{ar ? 'فضاء المريض' : 'Espace patient'}<ArrowRight aria-hidden="true" /></Link><Link href="/login/doctor" className="editorial-button editorial-button-outline"><Stethoscope aria-hidden="true" />{ar ? 'فضاء الطبيب' : 'Espace médecin'}<ArrowRight aria-hidden="true" /></Link></div>
      </section>
    </div>
  </div>;
}

function LandingDoctorCard({ doctor, locale }: { doctor: PublicDoctor; locale: string }) {
  const ar = locale === 'ar';
  const name = publicText(doctor.headline, locale) || doctor.slug;
  const city = doctor.clinics.map(clinic => publicClinicCity(clinic.address)).find(Boolean);
  // Public photos use our origin, as required by the application's image CSP.
  const photo = doctor.photoUrl?.startsWith('/') && !doctor.photoUrl.startsWith('//') ? doctor.photoUrl : null;
  const initials = name.replace(/^(Dr\.?|د\.)\s*/i, '').split(/\s+/).slice(0, 2).map(part => part[0]).join('');
  return <article className="editorial-doctor-card" data-testid="landing-doctor-card">
    <Link href={`/doctors/${doctor.slug}`} className="editorial-doctor-photo" aria-label={`${ar ? 'الملف الشخصي' : 'Voir le profil'} : ${name}`}>
      {photo ? <Image src={photo} alt={name} fill unoptimized sizes="(max-width: 640px) 100vw, 300px" /> : <span className="editorial-doctor-placeholder" aria-hidden="true"><span className="editorial-portrait-rings" /><Stethoscope /><span>{initials}</span></span>}
    </Link>
    <div className="editorial-doctor-info"><p className="editorial-doctor-kicker">{ar ? 'تعرف على طبيبك' : 'Rencontrez votre médecin'}</p><h3><Link href={`/doctors/${doctor.slug}`}>{name}</Link></h3><p>{publicText(doctor.specialty.name, locale)}</p>{city && <p className="editorial-doctor-city"><MapPin aria-hidden="true" />{city}</p>}<Link href={patientHref(`/p/doctors/${doctor.id}/book`)} className="editorial-button">{ar ? 'حجز موعد' : 'Prendre rendez-vous'}<ArrowRight aria-hidden="true" /></Link><Link href={`/doctors/${doctor.slug}`} className="editorial-doctor-profile">{ar ? 'عرض الملف الشخصي' : 'Découvrir le profil'}</Link></div>
  </article>;
}
