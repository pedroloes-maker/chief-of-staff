import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL não configurada — preencha em sma/.env ou sma/.env.local",
  );
}

const sqlClient = neon(process.env.DATABASE_URL);
export const db = drizzle(sqlClient, { schema });
