import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createInMemoryDatabase, closeDatabase } from "../src/db/init";
import { createCategory, createSubcategory } from "../src/categories";
import { computeContentHash } from "../src/hash";
import type { Database } from "bun:sqlite";
import {
  insertMemory,
  getMemoryById,
  searchMemories,
  deleteMemory,
  getMemoryCount,
  getMemoriesBySubcategory,
  updateRelevance,
  updateLastAccessed,
  getLowestRelevanceMemories,
  isAtCap,
  pruneToMakeRoom,
} from "../src/memories";

async function seedSubcategory(db: Database, name: string): Promise<number> {
  const catId = createCategory(db, `_test_cat_${name}`);
  return createSubcategory(db, name, catId).id;
}

async function makeContentHash(content: string): Promise<string> {
  return computeContentHash(content);
}

describe("insertMemory", () => {
  let db: Database;
  let subId: number;

  beforeAll(async () => {
    db = createInMemoryDatabase();
    subId = await seedSubcategory(db, "insert_test");
  });

  afterAll(() => {
    closeDatabase(db);
  });

  it("inserts a memory and stores fields correctly", async () => {
    const content = "This is a test memory content.";
    const hash = await makeContentHash(content);

    const result = insertMemory(db, {
      content,
      summary: "Test summary",
      contentHash: hash,
      relevance: 0.8,
      subcategoryId: subId,
      turnId: "turn-001",
      sessionId: "session-abc",
    });

    expect(result.created).toBe(true);
    expect(result.reinforced).toBe(false);
    expect(result.id).toBeGreaterThan(0);

    const mem = getMemoryById(db, result.id);
    expect(mem).not.toBeNull();
    expect(mem!.content).toBe(content);
    expect(mem!.summary).toBe("Test summary");
    expect(mem!.content_hash).toBe(hash);
    expect(mem!.relevance).toBe(0.8);
    expect(mem!.subcategory_id).toBe(subId);
    expect(mem!.turn_id).toBe("turn-001");
    expect(mem!.session_id).toBe("session-abc");
    expect(mem!.created_at).toBeGreaterThan(0);
    expect(mem!.last_accessed_at).toBeGreaterThan(0);
    expect(mem!.last_reinforced_at).toBeGreaterThan(0);
    expect(mem!.reinforcement_count).toBe(0);
  });

  it("reinforces instead of inserting when content_hash duplicates", async () => {
    const content = "This is unique duplicate-test content.";
    const hash = await makeContentHash(content);

    const first = insertMemory(db, {
      content,
      summary: "First insert",
      contentHash: hash,
      relevance: 0.5,
      subcategoryId: subId,
    });

    const second = insertMemory(db, {
      content,
      summary: "Duplicate attempt",
      contentHash: hash,
      relevance: 0.9,
      subcategoryId: subId,
    });

    expect(second.created).toBe(false);
    expect(second.reinforced).toBe(true);
    expect(second.id).toBe(first.id);

    const mem = getMemoryById(db, first.id);
    expect(mem).not.toBeNull();
    expect(mem!.reinforcement_count).toBe(1);
    expect(mem!.relevance).toBeGreaterThan(0.5);
  });

  it("throws when cap is reached", async () => {
    const subId2 = await seedSubcategory(db, "cap_test");
    const hash1 = await makeContentHash("cap-test-content-1");

    insertMemory(db, {
      content: "cap-test-content-1",
      summary: "cap test 1",
      contentHash: hash1,
      relevance: 0.5,
      subcategoryId: subId2,
    });

    const hash2 = await makeContentHash("cap-test-content-2");

    expect(() =>
      insertMemory(db, {
        content: "cap-test-content-2",
        summary: "cap test 2",
        contentHash: hash2,
        relevance: 0.5,
        subcategoryId: subId2,
      }, 1),
    ).toThrow("capacity limit of 1 reached");
  });
});

describe("getMemoryById", () => {
  let db: Database;

  beforeAll(async () => {
    db = createInMemoryDatabase();
  });

  afterAll(() => {
    closeDatabase(db);
  });

  it("returns null for non-existent id", () => {
    expect(getMemoryById(db, 99999)).toBeNull();
  });

  it("returns the correct memory for valid id", async () => {
    const subId = await seedSubcategory(db, "getbyid_test");
    const hash = await makeContentHash("get-by-id content");

    const result = insertMemory(db, {
      content: "get-by-id content",
      summary: "ID lookup",
      contentHash: hash,
      relevance: 0.7,
      subcategoryId: subId,
    });

    const mem = getMemoryById(db, result.id);
    expect(mem).not.toBeNull();
    expect(mem!.id).toBe(result.id);
    expect(mem!.summary).toBe("ID lookup");
  });
});

describe("searchMemories", () => {
  let db: Database;
  let subId: number;

  beforeAll(async () => {
    db = createInMemoryDatabase();
    subId = await seedSubcategory(db, "search_test");

    const entries = [
      { content: "Learn TypeScript programming", summary: "TS basics", relevance: 0.9 },
      { content: "Understand Rust ownership", summary: "Rust memory", relevance: 0.8 },
      { content: "Practice TypeScript generics", summary: "Advanced TS", relevance: 0.7 },
      { content: "Read about garbage collection", summary: "GC theory", relevance: 0.6 },
    ];

    for (const e of entries) {
      const hash = await makeContentHash(e.content);
      insertMemory(db, {
        content: e.content,
        summary: e.summary,
        contentHash: hash,
        relevance: e.relevance,
        subcategoryId: subId,
      });
    }
  });

  afterAll(() => {
    closeDatabase(db);
  });

  it("matches keyword in content", () => {
    const results = searchMemories(db, { keyword: "TypeScript" });
    expect(results.length).toBe(2);
    expect(results.every((r) => r.content.includes("TypeScript"))).toBe(true);
  });

  it("matches keyword in summary", () => {
    const results = searchMemories(db, { keyword: "Rust" });
    expect(results.length).toBe(1);
    expect(results[0].summary).toBe("Rust memory");
  });

  it("filters by subcategoryId", () => {
    const results = searchMemories(db, { subcategoryId: subId });
    expect(results.length).toBe(4);
  });

  it("returns empty for non-matching subcategory", () => {
    const results = searchMemories(db, { subcategoryId: 99999 });
    expect(results.length).toBe(0);
  });

  it("filters by minRelevance", () => {
    const results = searchMemories(db, { minRelevance: 0.8 });
    expect(results.length).toBe(2);
    expect(results.every((r) => r.relevance >= 0.8)).toBe(true);
  });

  it("respects limit", () => {
    const results = searchMemories(db, { limit: 2 });
    expect(results.length).toBe(2);
  });

  it("respects offset", () => {
    const all = searchMemories(db, { limit: 10 });
    const paged = searchMemories(db, { limit: 2, offset: 2 });
    expect(paged.length).toBe(2);
    expect(paged[0].id).toBe(all[2].id);
  });

  it("sorts by relevance DESC then created_at DESC", () => {
    const results = searchMemories(db, {});
    for (let i = 1; i < results.length; i++) {
      const prev = results[i - 1];
      const curr = results[i];
      if (prev.relevance === curr.relevance) {
        expect(prev.created_at).toBeGreaterThanOrEqual(curr.created_at);
      } else {
        expect(prev.relevance).toBeGreaterThanOrEqual(curr.relevance);
      }
    }
  });
});

describe("deleteMemory", () => {
  let db: Database;

  beforeAll(async () => {
    db = createInMemoryDatabase();
  });

  afterAll(() => {
    closeDatabase(db);
  });

  it("deletes a memory and it becomes unretrievable", async () => {
    const subId = await seedSubcategory(db, "delete_test");
    const hash = await makeContentHash("to delete");

    const result = insertMemory(db, {
      content: "to delete",
      summary: "delete me",
      contentHash: hash,
      relevance: 0.3,
      subcategoryId: subId,
    });

    expect(getMemoryById(db, result.id)).not.toBeNull();

    deleteMemory(db, result.id);

    expect(getMemoryById(db, result.id)).toBeNull();
  });

  it("is a no-op for non-existent id", () => {
    expect(() => deleteMemory(db, 99999)).not.toThrow();
  });
});

describe("getMemoryCount", () => {
  it("returns 0 for empty database", () => {
    const db = createInMemoryDatabase();
    expect(getMemoryCount(db)).toBe(0);
    closeDatabase(db);
  });

  it("returns correct count after inserts", async () => {
    const db = createInMemoryDatabase();
    const subId = await seedSubcategory(db, "count_test");

    for (let i = 0; i < 5; i++) {
      const hash = await makeContentHash(`count-content-${i}`);
      insertMemory(db, {
        content: `count-content-${i}`,
        summary: `summary ${i}`,
        contentHash: hash,
        relevance: 0.5,
        subcategoryId: subId,
      });
    }

    expect(getMemoryCount(db)).toBe(5);
    closeDatabase(db);
  });
});

describe("getMemoriesBySubcategory", () => {
  let db: Database;

  beforeAll(async () => {
    db = createInMemoryDatabase();
  });

  afterAll(() => {
    closeDatabase(db);
  });

  it("returns empty for subcategory with no memories", async () => {
    const subId = await seedSubcategory(db, "empty_sub");
    const results = getMemoriesBySubcategory(db, subId);
    expect(results).toEqual([]);
  });

  it("returns memories for a given subcategory", async () => {
    const subId = await seedSubcategory(db, "by_sub_test");
    const hash1 = await makeContentHash("sub content 1");
    const hash2 = await makeContentHash("sub content 2");

    insertMemory(db, {
      content: "sub content 1",
      summary: "s1",
      contentHash: hash1,
      relevance: 0.9,
      subcategoryId: subId,
    });
    insertMemory(db, {
      content: "sub content 2",
      summary: "s2",
      contentHash: hash2,
      relevance: 0.5,
      subcategoryId: subId,
    });

    const results = getMemoriesBySubcategory(db, subId);
    expect(results.length).toBe(2);
    expect(results[0].relevance).toBeGreaterThanOrEqual(results[1].relevance);
  });
});

describe("updateRelevance", () => {
  it("updates relevance and last_accessed_at", async () => {
    const db = createInMemoryDatabase();
    const subId = await seedSubcategory(db, "rel_test");
    const hash = await makeContentHash("relevance-update");

    const result = insertMemory(db, {
      content: "relevance-update",
      summary: "initial",
      contentHash: hash,
      relevance: 0.3,
      subcategoryId: subId,
    });

    const before = getMemoryById(db, result.id)!;
    const originalAccessed = before.last_accessed_at;

    updateRelevance(db, result.id, 0.95);

    const after = getMemoryById(db, result.id)!;
    expect(after.relevance).toBe(0.95);
    expect(after.last_accessed_at).toBeGreaterThanOrEqual(originalAccessed);

    closeDatabase(db);
  });
});

describe("updateLastAccessed", () => {
  it("updates only last_accessed_at", async () => {
    const db = createInMemoryDatabase();
    const subId = await seedSubcategory(db, "accessed_test");
    const hash = await makeContentHash("accessed-update");

    const result = insertMemory(db, {
      content: "accessed-update",
      summary: "before touch",
      contentHash: hash,
      relevance: 0.5,
      subcategoryId: subId,
    });

    const before = getMemoryById(db, result.id)!;

    updateLastAccessed(db, result.id);

    const after = getMemoryById(db, result.id)!;
    expect(after.last_accessed_at).toBeGreaterThanOrEqual(before.last_accessed_at);
    expect(after.relevance).toBe(before.relevance);
    expect(after.reinforcement_count).toBe(before.reinforcement_count);

    closeDatabase(db);
  });
});

describe("isAtCap", () => {
  it("returns false when under cap", async () => {
    const db = createInMemoryDatabase();
    const subId = await seedSubcategory(db, "atcap_test");

    const hash = await makeContentHash("cap check");
    insertMemory(db, {
      content: "cap check",
      summary: "check",
      contentHash: hash,
      relevance: 0.5,
      subcategoryId: subId,
    });

    expect(isAtCap(db, 10)).toBe(false);
    closeDatabase(db);
  });

  it("returns true when at cap", async () => {
    const db = createInMemoryDatabase();
    const subId = await seedSubcategory(db, "atcap_true_test");

    for (let i = 0; i < 3; i++) {
      const hash = await makeContentHash(`at-cap-${i}`);
      insertMemory(db, {
        content: `at-cap-${i}`,
        summary: `cap ${i}`,
        contentHash: hash,
        relevance: 0.5,
        subcategoryId: subId,
      });
    }

    expect(isAtCap(db, 3)).toBe(true);
    expect(isAtCap(db, 2)).toBe(true);
    closeDatabase(db);
  });
});

describe("getLowestRelevanceMemories", () => {
  it("returns memories sorted by relevance ascending", async () => {
    const db = createInMemoryDatabase();
    const subId = await seedSubcategory(db, "lowest_test");

    for (let i = 0; i < 5; i++) {
      const hash = await makeContentHash(`lowest-${i}`);
      insertMemory(db, {
        content: `lowest-${i}`,
        summary: `low ${i}`,
        contentHash: hash,
        relevance: 0.1 * i,
        subcategoryId: subId,
      });
    }

    const results = getLowestRelevanceMemories(db, 3);
    expect(results.length).toBe(3);

    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].relevance).toBeLessThanOrEqual(results[i].relevance);
    }
  });
});

describe("pruneToMakeRoom", () => {
  it("deletes lowest relevance memories to reach target", async () => {
    const db = createInMemoryDatabase();
    const subId = await seedSubcategory(db, "prune_test");

    for (let i = 0; i < 5; i++) {
      const hash = await makeContentHash(`prune-${i}`);
      insertMemory(db, {
        content: `prune-${i}`,
        summary: `p ${i}`,
        contentHash: hash,
        relevance: i * 0.1,
        subcategoryId: subId,
      });
    }

    expect(getMemoryCount(db)).toBe(5);

    const deleted = pruneToMakeRoom(db, 5, 2);
    expect(deleted).toBe(3);
    expect(getMemoryCount(db)).toBe(2);

    const remaining = searchMemories(db, { limit: 100 });
    expect(remaining.every((r) => r.relevance >= 0.2)).toBe(true);

    closeDatabase(db);
  });

  it("returns 0 when already under target", async () => {
    const db = createInMemoryDatabase();
    const subId = await seedSubcategory(db, "noprune_test");
    const hash = await makeContentHash("no-prune");

    insertMemory(db, {
      content: "no-prune",
      summary: "keep",
      contentHash: hash,
      relevance: 0.5,
      subcategoryId: subId,
    });

    expect(getMemoryCount(db)).toBe(1);
    const deleted = pruneToMakeRoom(db, 10, 5);
    expect(deleted).toBe(0);
    expect(getMemoryCount(db)).toBe(1);

    closeDatabase(db);
  });
});
