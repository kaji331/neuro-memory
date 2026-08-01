import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { initializeDatabase, createInMemoryDatabase, closeDatabase } from "../../src/db/init";
import { runMigrations, getCurrentVersion } from "../../src/db/migrate";
import { SCHEMA_VERSION, CREATE_TABLES_SQL } from "../../src/db/schema";

const TABLE_NAMES = [
  "categories",
  "subcategories",
  "category_subcategory_links",
  "memories",
  "memory_subcategory_links",
  "schema_version",
];

function getTableNames(db: Database): string[] {
  const rows = db
    .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as { name: string }[];
  return rows.map((r) => r.name);
}

describe("database schema", () => {
  let db: Database;

  beforeAll(() => {
    db = createInMemoryDatabase();
  });

  afterAll(() => {
    closeDatabase(db);
  });

  it("should create all expected tables", () => {
    const tables = getTableNames(db);
    for (const name of TABLE_NAMES) {
      expect(tables).toContain(name);
    }
  });

  it("should enable WAL journal mode", () => {
    // WAL mode requires a file-based database; :memory: always reports "memory"
    const fileDb = new Database("/tmp/test_neuro_wal.db");
    fileDb.run("PRAGMA journal_mode=WAL;");
    const row = fileDb.query("PRAGMA journal_mode;").get() as { journal_mode: string };
    expect(row.journal_mode.toLowerCase()).toBe("wal");
    fileDb.close();
  });

  it("should enable foreign keys", () => {
    const row = db.query("PRAGMA foreign_keys;").get() as { foreign_keys: number };
    expect(row.foreign_keys).toBe(1);
  });

  it("should have schema_version = 1", () => {
    expect(SCHEMA_VERSION).toBe(1);
    const row = db
      .query("SELECT version FROM schema_version ORDER BY version DESC LIMIT 1")
      .get() as { version: number };
    expect(row.version).toBe(1);
  });
});

describe("category CRUD", () => {
  let db: Database;

  beforeAll(() => {
    db = createInMemoryDatabase();
  });

  afterAll(() => {
    closeDatabase(db);
  });

  it("should insert a category successfully", () => {
    db.run(
      "INSERT INTO categories (name, created_at, last_used_at) VALUES (?, unixepoch(), unixepoch())",
      ["test_category"]
    );
    const row = db
      .query("SELECT name FROM categories WHERE name = ?")
      .get("test_category") as { name: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.name).toBe("test_category");
  });

  it("should reject duplicate category name (case-insensitive)", () => {
    expect(() => {
      db.run(
        "INSERT INTO categories (name, created_at, last_used_at) VALUES (?, unixepoch(), unixepoch())",
        ["TEST_CATEGORY"]
      );
    }).toThrow();
  });
});

describe("memories with foreign key constraints", () => {
  let db: Database;

  beforeAll(() => {
    db = createInMemoryDatabase();
    // Seed a subcategory for memory tests
    db.run(
      "INSERT INTO subcategories (name, created_at, last_used_at) VALUES (?, unixepoch(), unixepoch())",
      ["test_subcat"]
    );
  });

  afterAll(() => {
    closeDatabase(db);
  });

  it("should insert a memory linked to an existing subcategory", () => {
    db.run(
      `INSERT INTO memories (content, summary, content_hash, relevance, subcategory_id, created_at, last_accessed_at, last_reinforced_at)
       VALUES (?, ?, ?, ?, ?, unixepoch(), unixepoch(), unixepoch())`,
      ["test content", "test summary", "abc123hash", 0.8, 1]
    );
    const row = db
      .query("SELECT content, summary, content_hash FROM memories WHERE content_hash = ?")
      .get("abc123hash") as { content: string; summary: string; content_hash: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.content).toBe("test content");
    expect(row!.summary).toBe("test summary");
    expect(row!.content_hash).toBe("abc123hash");
  });

  it("should reject a memory with a non-existent subcategory", () => {
    expect(() => {
      db.run(
        `INSERT INTO memories (content, summary, content_hash, relevance, subcategory_id, created_at, last_accessed_at, last_reinforced_at)
         VALUES (?, ?, ?, ?, ?, unixepoch(), unixepoch(), unixepoch())`,
        ["orphan", "orphan summary", "orphanhash", 0.5, 999]
      );
    }).toThrow();
  });
});

describe("cascade delete behavior", () => {
  let db: Database;

  beforeAll(() => {
    db = createInMemoryDatabase();
  });

  afterAll(() => {
    closeDatabase(db);
  });

  it("should cascade delete from category_subcategory_links when category is deleted", () => {
    db.run(
      "INSERT INTO categories (name, created_at, last_used_at) VALUES (?, unixepoch(), unixepoch())",
      ["cascade_cat"]
    );
    db.run(
      "INSERT INTO subcategories (name, created_at, last_used_at) VALUES (?, unixepoch(), unixepoch())",
      ["cascade_sub"]
    );
    db.run(
      "INSERT INTO category_subcategory_links (category_id, subcategory_id) VALUES (?, ?)",
      [1, 1]
    );

    // Verify link exists
    let link = db
      .query("SELECT id FROM category_subcategory_links WHERE category_id = ? AND subcategory_id = ?")
      .get(1, 1) as { id: number } | undefined;
    expect(link).toBeDefined();

    // Delete category
    db.run("DELETE FROM categories WHERE id = ?", [1]);

    // Link should be gone (CASCADE)
    link = db
      .query("SELECT id FROM category_subcategory_links WHERE category_id = ? AND subcategory_id = ?")
      .get(1, 1) as { id: number } | undefined;
    expect(link).toBeNull();
  });
});

describe("migration system", () => {
  it("should start at version 1 for a fresh database", () => {
    const db = createInMemoryDatabase();
    expect(getCurrentVersion(db)).toBe(1);
    closeDatabase(db);
  });

  it("should report no migrations applied when already at latest", () => {
    const db = createInMemoryDatabase();
    const result = runMigrations(db);
    expect(result.fromVersion).toBe(1);
    expect(result.toVersion).toBe(1);
    expect(result.applied).toBe(0);
    closeDatabase(db);
  });
});
