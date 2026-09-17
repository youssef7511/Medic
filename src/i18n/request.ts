import { getRequestConfig } from 'next-intl/server';
import { defaultLocale, isLocale } from './config';

// Wires next-intl into the App Router. Referenced by next.config.mjs.
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = requested && isLocale(requested) ? requested : defaultLocale;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
