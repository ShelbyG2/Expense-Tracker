// Password hashing with bcryptjs. Never returns or logs plaintext passwords.

import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'

const SALT_ROUNDS = 12

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS)
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

// Temporary password for an admin-initiated reset (Phase 7A): short enough to
// read out, long enough to satisfy the 8-character policy, crypto-random.
export function generateTemporaryPassword(): string {
  return `Temp-${randomBytes(9).toString('base64url')}`
}
