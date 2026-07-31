import { hash, compare } from 'bcryptjs';

// Cost 12: ~250ms on commodity hardware. Deliberately slow — this is the only
// thing standing between a leaked hash and a patient's account.
const COST = 12;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, COST);
}

export function verifyPassword(plain: string, hashed: string): Promise<boolean> {
  return compare(plain, hashed);
}

/**
 * Constant-ish-time miss for unknown accounts.
 *
 * Without this, "email not found" returns in ~1ms while a real account takes
 * ~250ms — a timing oracle that lets anyone enumerate which emails are
 * registered on a medical platform. Knowing someone has an account here is
 * itself sensitive (§10), so unknown emails burn the same CPU as real ones.
 */
export async function fakeVerify(): Promise<void> {
  await compare('dummy-password', '$2a$12$C6UzMDM.H6dfI/f/IKcEe.J2K1e0FLVOFA5.z4a0f6Vg0K7CqQOaC');
}
