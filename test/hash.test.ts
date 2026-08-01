import { describe, it, expect, beforeAll } from "bun:test";
import { Database } from "bun:sqlite";
import { resolve } from "path";
import { unlinkSync, existsSync, mkdirSync } from "fs";
import { tmpdir } from "os";

import {
  normalizeContent,
  computeContentHash,
  findDuplicate,
  reinforceMemory,
} from "../src/hash";
import { getDefaultConfig } from "../src/config";
import { CREATE_TABLES_SQL } from "../src/db/schema";

// ── Helpers ──────────────────────────────────────────────────────────────────

const TMP_DIR = resolve(tmpdir(), "neuro-memory-hash-test");

function createTestDb(): Database {
  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
  const dbPath = resolve(TMP_DIR, `hash-test-${Date.now()}.db`);
  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  for (const sql of CREATE_TABLES_SQL) {
    db.exec(sql);
  }
  return db;
}

function insertMemory(
  db: Database,
  overrides: Partial<{
    content: string;
    summary: string;
    content_hash: string;
    relevance: number;
    subcategory_id: number;
    created_at: number;
    last_accessed_at: number;
    last_reinforced_at: number;
    reinforcement_count: number;
  }> = {},
): number {
  const row: Record<string, unknown> = {
    $content: overrides.content ?? "test content",
    $summary: overrides.summary ?? "test summary",
    $content_hash: overrides.content_hash ?? "abc123",
    $relevance: overrides.relevance ?? 0.5,
    $subcategory_id: overrides.subcategory_id ?? 1,
    $created_at: overrides.created_at ?? Math.floor(Date.now() / 1000),
    $last_accessed_at: overrides.last_accessed_at ?? Math.floor(Date.now() / 1000),
    $last_reinforced_at: overrides.last_reinforced_at ?? Math.floor(Date.now() / 1000),
    $reinforcement_count: overrides.reinforcement_count ?? 0,
  };

  db.prepare(
    `INSERT INTO memories (
      content, summary, content_hash, relevance,
      subcategory_id, created_at, last_accessed_at,
      last_reinforced_at, reinforcement_count
    ) VALUES ($content, $summary, $content_hash, $relevance,
      $subcategory_id, $created_at, $last_accessed_at,
      $last_reinforced_at, $reinforcement_count)`,
  ).run(row);

  return (db.prepare("SELECT last_insert_rowid()").get() as { "last_insert_rowid()": number })["last_insert_rowid()"];
}

// ── Tests: normalizeContent ──────────────────────────────────────────────────

describe("normalizeContent", () => {
  it("trims leading and trailing whitespace", () => {
    expect(normalizeContent("  hello world  ")).toBe("hello world");
  });

  it("preserves newlines", () => {
    expect(normalizeContent("line1\nline2")).toBe("line1\nline2");
  });

  it("converts to lowercase", () => {
    expect(normalizeContent("Hello World")).toBe("hello world");
  });

  it("collapses multiple consecutive spaces", () => {
    expect(normalizeContent("hello   world    foo")).toBe("hello world foo");
  });

  it("removes non-printable characters", () => {
    expect(normalizeContent("hello\x00world\x1Ftest")).toBe("helloworldtest");
  });

  it("applies all normalizations together", () => {
    expect(normalizeContent("  Hello   WORLD\x00!  "))
      .toBe("hello world!");
  });
});

// ── Tests: computeContentHash ────────────────────────────────────────────────

describe("computeContentHash", () => {
  it("returns a 64-character hex string (SHA-256)", async () => {
    const hash = await computeContentHash("hello world");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic: same content produces same hash", async () => {
    const a = await computeContentHash("the same content");
    const b = await computeContentHash("the same content");
    expect(a).toBe(b);
  });

  it("produces different hash for different content", async () => {
    const a = await computeContentHash("content one");
    const b = await computeContentHash("content two");
    expect(a).not.toBe(b);
  });

  it("normalizes content before hashing (trim+case+spaces)", async () => {
    const a = await computeContentHash("  Hello   World  ");
    const b = await computeContentHash("hello world");
    expect(a).toBe(b);
  });

  it("empty string is valid input", async () => {
    const hash = await computeContentHash("");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ── Tests: findDuplicate ─────────────────────────────────────────────────────

describe("findDuplicate", () => {
  let db: Database;

  beforeAll(async () => {
    db = createTestDb();
  });

  it("returns null for non-existent hash", () => {
    const result = findDuplicate(db, "nonexistent_hash_xyz");
    expect(result).toBeNull();
  });

  it("returns the matching record when hash exists", () => {
    const hash = "known_hash_001";
    insertMemory(db, {
      content: "existing memory",
      summary: "existing summary",
      content_hash: hash,
      relevance: 0.8,
    });

    const result = findDuplicate(db, hash);
    expect(result).not.toBeNull();
    expect(result!.content).toBe("existing memory");
    expect(result!.summary).toBe("existing summary");
    expect(result!.relevance).toBe(0.8);
    expect(result!.id).toBeGreaterThan(0);
  });
});

// ── Tests: reinforceMemory ───────────────────────────────────────────────────

describe("reinforceMemory", () => {
  let db: Database;
  let memoryId: number;

  beforeAll(async () => {
    db = createTestDb();
    memoryId = insertMemory(db, {
      content_hash: "reinforce_test_hash",
      relevance: 0.5,
      reinforcement_count: 0,
    });
  });

  it("increments reinforcement_count by 1", () => {
    reinforceMemory(db, memoryId, 0.15);

    const row = db
      .prepare("SELECT reinforcement_count, last_reinforced_at, relevance FROM memories WHERE id = ?")
      .get(memoryId) as { reinforcement_count: number; last_reinforced_at: number; relevance: number };

    expect(row.reinforcement_count).toBe(1);
  });

  it("updates last_reinforced_at to current unix timestamp", () => {
    const now = Math.floor(Date.now() / 1000);
    const row = db
      .prepare("SELECT last_reinforced_at FROM memories WHERE id = ?")
      .get(memoryId) as { last_reinforced_at: number };

    expect(row.last_reinforced_at).toBeGreaterThanOrEqual(now - 1);
  });

  it("boosts relevance by the given amount", () => {
    const row = db
      .prepare("SELECT relevance FROM memories WHERE id = ?")
      .get(memoryId) as { relevance: number };

    expect(row.relevance).toBe(0.65); // 0.5 + 0.15
  });

  it("clamps relevance at 1.0", () => {
    db.prepare("UPDATE memories SET relevance = 0.9 WHERE id = ?").run(memoryId);
    reinforceMemory(db, memoryId, 0.2);
    const row = db
      .prepare("SELECT relevance FROM memories WHERE id = ?")
      .get(memoryId) as { relevance: number };

    expect(row.relevance).toBe(1.0);
  });
});
