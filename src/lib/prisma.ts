import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
const globalDb = globalThis as unknown as { prisma?: PrismaClient };
const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./prisma/dev.db" });
export const prisma = globalDb.prisma ?? new PrismaClient({ adapter });
if (process.env.NODE_ENV !== "production") globalDb.prisma = prisma;
