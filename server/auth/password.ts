import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// scrypt do node:crypto — sem dependência nativa extra, roda em Node e Bun.
// Formato: scrypt:<salt hex>:<hash hex>
const KEYLEN = 64;

export function hashPassword(senha: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(senha, salt, KEYLEN);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(senha: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split(":");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(senha, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}
