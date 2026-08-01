import { Database } from "bun:sqlite";
import { SCHEMA_VERSION } from "./schema";

export interface MigrationResult {
  fromVersion: number;
  toVersion: number;
  applied: number;
}

/**
 * Map of version -> migration function.
 * To add a new migration, append a new entry like:
 *   [2]: (db) => { db.run("ALTER TABLE ..."); }
 */
const MIGRATIONS: Record<number, (db: Database) => void> = {};

export function getCurrentVersion(db: Database): number {
  const row = db
    .query("SELECT COALESCE(MAX(version), 0) as version FROM schema_version")
    .get() as { version: number };
  return row.version;
}

export function runMigrations(db: Database): MigrationResult {
  const fromVersion = getCurrentVersion(db);

  let applied = 0;
  for (let v = fromVersion + 1; v <= SCHEMA_VERSION; v++) {
    const migration = MIGRATIONS[v];
    if (migration) {
      migration(db);
      db.run("INSERT INTO schema_version (version) VALUES (?);", [v]);
      applied++;
    }
  }

  const toVersion = getCurrentVersion(db);
  return { fromVersion, toVersion, applied };
}
