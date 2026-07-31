import createMiddleware from 'next-intl/middleware';
import { routing } from '@/i18n/navigation';

// Locale routing at the edge. Auth/RBAC enforcement lives in server components
// and route handlers via the guard (src/lib/rbac), NOT here — middleware is the
// wrong layer to make authorization decisions for clinical data (§5).
export default createMiddleware(routing);

export const config = {
  // Run on everything except Next internals, the API, and static assets.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
