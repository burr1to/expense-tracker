import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function getPrisma() {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");
  const url = new URL(connectionString);
  const password = decodeURIComponent(url.password);
  const client = new PrismaClient({ adapter: new PrismaPg({
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password,
    database: url.pathname.slice(1),
    ssl: { rejectUnauthorized: false },
    max: 5,
    connectionTimeoutMillis: 10_000,
  }) });
  globalForPrisma.prisma = client;
  return client;
}
