import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb(db: D1Database | undefined) {
  if (!db) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Configure the binding in wrangler.jsonc before using the database."
    );
  }

  return drizzle(db, { schema });
}
