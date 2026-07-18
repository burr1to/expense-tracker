import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;

function derivePin(pin: string, salt: string) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(pin, salt, KEY_LENGTH, (error, key) => error ? reject(error) : resolve(key));
  });
}

export async function hashPin(pin: string) {
  const salt = randomBytes(16).toString("hex");
  const key = await derivePin(pin, salt);
  return `${salt}:${key.toString("hex")}`;
}

export async function verifyPin(pin: string, storedHash: string) {
  const [salt, expectedHex] = storedHash.split(":");
  if (!salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = await derivePin(pin, salt);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
