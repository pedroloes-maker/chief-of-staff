import "../env";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não configurada");
}

const sqlClient = neon(process.env.DATABASE_URL);
const db = drizzle(sqlClient);

await migrate(db, { migrationsFolder: "./drizzle" });
console.log("Migrations aplicadas.");
