export { SCHEMA_VERSION, CREATE_TABLES_SQL, CREATE_INDEXES_SQL } from "./schema";
export { initializeDatabase, createInMemoryDatabase, closeDatabase } from "./init";
export { runMigrations, getCurrentVersion } from "./migrate";
export type { MigrationResult } from "./migrate";
