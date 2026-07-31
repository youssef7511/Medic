import { handlers } from '@/auth';

// Node runtime (not edge): authorize() uses bcrypt + Prisma.
export const runtime = 'nodejs';

export const { GET, POST } = handlers;
