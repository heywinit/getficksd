import * as schema from "../schema";
import dotenv from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

dotenv.config({ path: "../../apps/web/.env" });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("Set DATABASE_URL in apps/web/.env before running database scripts.");
}

export const sql = postgres(databaseUrl, { max: 1 });
export const scriptDb = drizzle({ client: sql, schema });
