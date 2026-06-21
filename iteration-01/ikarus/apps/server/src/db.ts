import { PrismaClient } from "@prisma/client";

/**
 * Lazy Prisma singleton. Constructed on first access so tests and the in-memory
 * demo spine never instantiate a client (no DATABASE_URL needed). `hasDatabase()`
 * gates the DB-backed code paths; without it the server runs the in-memory demo.
 */
let client: PrismaClient | null = null;

export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function db(): PrismaClient {
  if (!client) {
    if (!hasDatabase()) {
      throw new Error("DATABASE_URL is not set — DB-backed features are unavailable.");
    }
    client = new PrismaClient();
  }
  return client;
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}
