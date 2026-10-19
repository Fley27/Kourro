// expo-sqlite web implementation backed by SQLite compiled to WASM
// (wa-sqlite 1.0.0) with the IDBBatchAtomicVFS persisting to IndexedDB.
//
// The shared db layer (mobile-app/src/db/index.ts) is untouched: its
// `runAsync` / `getAllAsync` / `getFirstAsync` / `execAsync` calls are mapped
// onto the wa-sqlite low-level API. Local data therefore lives in IndexedDB,
// wrapped in a real SQLite image, so all SQL — including the sync engine's
// INSERT OR REPLACE statements — behaves exactly as on device.
//
// Notable platform differences handled here:
//   - `PRAGMA journal_mode=WAL` (schema.ts line 3) is invalid for this VFS
//     (no shared-memory file). It is rewritten to DELETE journal mode.
//   - expo-sqlite returns `lastInsertRowId`; wa-sqlite has no direct API, so
//     we run `SELECT last_insert_rowid()` on the same connection.
//   - Booleans are converted to 0/1 (wa-sqlite would otherwise warn + bind
//     NULL).
//   - All statements are serialized through a queue so concurrent callers
//     (sync push/pull, UI writes) never interleave mid-statement; this also
//     keeps manual BEGIN/COMMIT sequences ordered.
import SQLiteESMFactory from "wa-sqlite/dist/wa-sqlite-async.mjs";
import * as SQLite from "wa-sqlite";
import { IDBBatchAtomicVFS } from "wa-sqlite/src/examples/IDBBatchAtomicVFS.js";
import wasmUrl from "wa-sqlite/dist/wa-sqlite-async.wasm?url";

const VFS_NAME = "jesyon-idb";
const DATABASE_FILE = "jesyon.db";

type SqlParam = string | number | null | undefined | boolean | Uint8Array | ArrayBuffer | bigint;
type SqlParams = SqlParam[] | Record<string, SqlParam | undefined>;
type Row = Record<string, any>;

let enginePromise: Promise<any> | null = null;

function getEngine(): Promise<any> {
  if (!enginePromise) {
    enginePromise = (async () => {
      const module = await SQLiteESMFactory({
        locateFile: (path: string) => (path.endsWith(".wasm") ? wasmUrl : path),
      });
      const sqlite3: any = SQLite.Factory(module);
      const vfs = new IDBBatchAtomicVFS(VFS_NAME);
      sqlite3.vfs_register(vfs, true);
      return sqlite3;
    })();
  }
  return enginePromise;
}

/**
 * The one statement that cannot run against the IndexedDB VFS: WAL needs a
 * shared-memory file. Rewrite it to DELETE journal mode (still crash-safe,
 * and the VFS batch-atomic writes keep it consistent).
 */
function prepareSql(sql: string): string {
  return sql.replace(
    /\bpragma\s+journal_mode\s*(?:=\s*)?['"]?wal['"]?/gi,
    "PRAGMA journal_mode = DELETE"
  );
}

function sanitizeValue(value: SqlParam): string | number | null | Uint8Array | bigint | undefined {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return value as string | number | null | Uint8Array | bigint | undefined;
}

function bindParams(sqlite3: any, stmt: number, params?: SqlParams): void {
  if (!params) return;
  if (Array.isArray(params)) {
    sqlite3.bind_collection(
      stmt,
      params.map((p) => sanitizeValue(p))
    );
    return;
  }
  // Named parameters: match expo's `$name` convention, but accept bare keys
  // (`name`), `:name` and `@name` too.
  const count = sqlite3.bind_parameter_count(stmt);
  for (let i = 1; i <= count; i++) {
    const raw = sqlite3.bind_parameter_name(stmt, i) as string | null;
    if (!raw) continue;
    const bare = raw.replace(/^[$:@]/, "");
    const value = params[raw] !== undefined ? params[raw] : params[bare];
    if (value === undefined) continue;
    sqlite3.bind(stmt, i, sanitizeValue(value));
  }
}

function rowToObject(columns: string[], values: any[]): Row {
  const obj: Row = {};
  for (let i = 0; i < columns.length; i++) obj[columns[i]] = values[i];
  return obj;
}

export type WebSQLiteRunResult = { lastInsertRowId: number; changes: number };

class WebDatabase {
  #db: number;
  #tail: Promise<unknown> = Promise.resolve();
  #transactionDepth = 0;
  #closed = false;

  constructor(db: number) {
    this.#db = db;
  }

  #serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#tail.then(task, task);
    this.#tail = run.catch(() => undefined);
    return run;
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("database is closed");
  }

  async #collect(sql: string, params?: SqlParams): Promise<{ rows: Row[]; columns: string[] }> {
    const sqlite3 = await getEngine();
    const rows: Row[] = [];
    let columns: string[] = [];
    for await (const stmt of sqlite3.statements(this.#db, sql)) {
      bindParams(sqlite3, stmt, params);
      let rc: number;
      while ((rc = await sqlite3.step(stmt)) === SQLite.SQLITE_ROW) {
        if (columns.length === 0) columns = sqlite3.column_names(stmt);
        rows.push(rowToObject(columns, sqlite3.row(stmt)));
      }
    }
    return { rows, columns };
  }

  async #run(sql: string, params?: SqlParams): Promise<WebSQLiteRunResult> {
    const sqlite3 = await getEngine();
    for await (const stmt of sqlite3.statements(this.#db, sql)) {
      bindParams(sqlite3, stmt, params);
      let rc: number;
      do {
        rc = await sqlite3.step(stmt);
      } while (rc === SQLite.SQLITE_ROW);
    }
    const changes = sqlite3.changes(this.#db);
    const { rows } = await this.#collect("SELECT last_insert_rowid() AS rowid");
    const lastInsertRowId = Number(rows[0]?.rowid ?? 0);
    return { lastInsertRowId, changes };
  }

  runAsync(sql: string, params?: SqlParams): Promise<WebSQLiteRunResult> {
    return this.#serial(async () => {
      this.#assertOpen();
      return this.#run(prepareSql(sql), params);
    });
  }

  async getAllAsync<T = Row>(sql: string, params?: SqlParams): Promise<T[]> {
    return this.#serial(async () => {
      this.#assertOpen();
      const { rows } = await this.#collect(prepareSql(sql), params);
      return rows as T[];
    });
  }

  async getFirstAsync<T = Row>(sql: string, params?: SqlParams): Promise<T | null> {
    const rows = await this.getAllAsync<T>(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  execAsync(sql: string): Promise<void> {
    return this.#serial(async () => {
      this.#assertOpen();
      const sqlite3 = await getEngine();
      await sqlite3.exec(this.#db, prepareSql(sql));
    });
  }

  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    return this.#serial(async () => {
      this.#assertOpen();
      const sqlite3 = await getEngine();
      this.#transactionDepth++;
      try {
        await sqlite3.exec(this.#db, "BEGIN");
        try {
          await task();
          await sqlite3.exec(this.#db, "COMMIT");
        } catch (error) {
          try {
            await sqlite3.exec(this.#db, "ROLLBACK");
          } catch {
            /* rollback is best-effort — surface the original error */
          }
          throw error;
        }
      } finally {
        this.#transactionDepth--;
      }
    });
  }

  async withExclusiveTransactionAsync(task: (txn: WebDatabase) => Promise<void>): Promise<void> {
    return this.withTransactionAsync(() => task(this));
  }

  async closeAsync(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#serial(async () => {
      const sqlite3 = await getEngine();
      await sqlite3.close(this.#db);
    });
  }

  closeSync(): void {
    void this.closeAsync();
  }
}

async function setupConnection(db: WebDatabase): Promise<void> {
  // Match expo-sqlite defaults (foreign keys ON) and add patience for
  // multi-tab contention.
  await db.execAsync("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
}

export async function openDatabaseAsync(_name: string): Promise<WebDatabase> {
  const sqlite3 = await getEngine();
  const db = await sqlite3.open_v2(
    DATABASE_FILE,
    SQLite.SQLITE_OPEN_READWRITE | SQLite.SQLITE_OPEN_CREATE,
    VFS_NAME
  );
  const database = new WebDatabase(db);
  await setupConnection(database);
  return database;
}

export function openDatabaseSync(_name: string): WebDatabase {
  throw new Error("openDatabaseSync is not supported on web — use openDatabaseAsync");
}

export function deleteDatabaseAsync(_name: string): Promise<void> {
  return Promise.reject(new Error("deleteDatabaseAsync is not supported on web"));
}

export async function isAvailableAsync(): Promise<boolean> {
  return true;
}

export default {
  openDatabaseAsync,
  openDatabaseSync,
  deleteDatabaseAsync,
  isAvailableAsync,
};
