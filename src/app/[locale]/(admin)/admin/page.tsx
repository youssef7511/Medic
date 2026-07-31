import { getTranslations } from 'next-intl/server';

// Admin home (§6, Phase 6). The doctor-onboarding queue lives here: license
// verification is a MANUAL human gate before publish (§10) — never automated.
export default async function AdminHomePage() {
  const t = await getTranslations();
  return (
    <section>
      <h1 className="text-2xl font-bold">{t('spaces.admin')}</h1>
      <ul className="mt-6 space-y-2 text-gray-600">
        <li>• Doctor onboarding &amp; license verification (manual gate)</li>
        <li>• User management &amp; role assignment (SUPER_ADMIN)</li>
        <li>• Audit log viewer</li>
      </ul>
      <p className="mt-6 text-sm text-gray-400">
        Note: admins cannot read consultation notes or messages (§5). Clinical
        access requires the separate, audited break-glass flow.
      </p>
    </section>
  );
}
