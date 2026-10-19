import postgres from "postgres";
import { env } from "./env.js";

if (!env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set — copy .env.example to .env and fill it in.");
}

export const sql = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  onnotice: () => {},
});

/** Anything queryable with the same call signature — pool or transaction. */
export type Db = postgres.Sql<any> | postgres.TransactionSql<any>;
