import { Database } from "bun:sqlite";
import { CREATE_TABLES_SQL, CREATE_INDEXES_SQL, SCHEMA_VERSION } from "./schema";

export function initializeDatabase(dbPath: string): Database {
  const db = new Database(dbPath);

  // Enable WAL mode for concurrent reads during writes
  db.run("PRAGMA journal_mode=WAL;");

  // Enable foreign key enforcement
  db.run("PRAGMA foreign_keys=ON;");

  // Create all tables
  for (const sql of CREATE_TABLES_SQL) {
    db.run(sql);
  }

  // Create all indexes
  for (const sql of CREATE_INDEXES_SQL) {
    db.run(sql);
  }

  // Ensure schema_version table exists and seed with current version if empty
  db.run(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);`);
  const row = db.query("SELECT version FROM schema_version ORDER BY version DESC LIMIT 1").get() as { version: number } | undefined;
  if (!row) {
    db.run("INSERT INTO schema_version (version) VALUES (?);", [SCHEMA_VERSION]);
  }

  return db;
}

export function createInMemoryDatabase(): Database {
  return initializeDatabase(":memory:");
}

export function closeDatabase(db: Database): void {
  db.close();
}
