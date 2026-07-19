import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaDatabaseUrl?: string;
};

export function getPrisma() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");

  if (
    globalForPrisma.prisma &&
    globalForPrisma.prismaDatabaseUrl === connectionString
  ) {
    return globalForPrisma.prisma;
  }

  if (globalForPrisma.prisma) {
    void globalForPrisma.prisma.$disconnect().catch(() => undefined);
  }

  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
  globalForPrisma.prisma = client;
  globalForPrisma.prismaDatabaseUrl = connectionString;
  return client;
}
