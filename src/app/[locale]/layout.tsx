import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { locales, localeDirection, isLocale, type Locale } from '@/i18n/config';
import '../globals.css';

export const metadata: Metadata = {
  title: 'Medic',
  description: 'Trouvez votre médecin et prenez rendez-vous.',
};

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  // Enable static rendering for this locale.
  setRequestLocale(locale);

  // Client components calling useTranslations need the catalogue explicitly —
  // without this the provider is empty and every t() throws MISSING_MESSAGE.
  const messages = await getMessages();

  // §9: dir is derived from the locale, set on <html> once, and every component
  // uses logical properties — so RTL "just works" without per-component effort.
  const dir = localeDirection[locale as Locale];

  return (
    <html lang={locale} dir={dir}>
      <body>
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
