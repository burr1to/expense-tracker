import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;

function deriveSecret(secret: string, salt: string) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(secret, salt, KEY_LENGTH, (error, key) => error ? reject(error) : resolve(key));
  });
}
export async function hashRecoverySecret(secret: string) {
  const salt = randomBytes(16).toString("hex");
  const key = await deriveSecret(secret, salt);
  return `${salt}:${key.toString("hex")}`;
}

export async function verifyRecoverySecret(secret: string, storedHash: string) {
  const [salt, expectedHex] = storedHash.split(":");
  if (!salt || !expectedHex) return false;
  try {
    const expected = Buffer.from(expectedHex, "hex");
    const actual = await deriveSecret(secret, salt);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
