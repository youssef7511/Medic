/** Match the public Host, because a standalone server’s request URL uses its container hostname. */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const url = new URL(request.url);
  const host = request.headers.get('host') ?? url.host;
  const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? url.protocol.slice(0, -1);
  if (protocol !== 'http' && protocol !== 'https') return false;
  try { return origin === new URL(`${protocol}://${host}`).origin; }
  catch { return false; }
}
