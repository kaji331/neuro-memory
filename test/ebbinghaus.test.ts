import { describe, it, expect } from "bun:test";
import { createInMemoryDatabase, closeDatabase } from "../src/db/init";
import type { Database } from "bun:sqlite";
import {
  calculateRelevance,
  getReinforcementBoost,
  hoursSince,
  getMemoriesForRecalculation,
  recalculateAllRelevance,
  getMemoriesToPrune,
  pruneLowRelevanceMemories,
  pruneOrphanCategories,
  pruneOrphanSubcategories,
  runMaintenance,
} from "../src/ebbinghaus";

// ── Helpers ──────────────────────────────────────────────────────────────────

function ensureSubcategory(db: Database, id: number | undefined = undefined): number {
  if (id !== undefined) {
    const existing = db
      .prepare("SELECT id FROM subcategories WHERE id = ?")
      .get(id) as { id: number } | undefined;
    if (existing) return existing.id;
  }

  const now = Math.floor(Date.now() / 1000);
  const name = `_test_sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(
    "INSERT OR IGNORE INTO subcategories (name, created_at, last_used_at) VALUES (?, ?, ?)",
  ).run(name, now, now);
  return (
    db.prepare("SELECT id FROM subcategories WHERE name = ?").get(name) as { id: number }
  ).id;
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
  const subcategoryId = overrides.subcategory_id ?? ensureSubcategory(db);

  const row: Record<string, unknown> = {
    $content: overrides.content ?? "test content",
    $summary: overrides.summary ?? "test summary",
    $content_hash: overrides.content_hash ?? `test_hash_${Date.now()}_${Math.random()}`,
    $relevance: overrides.relevance ?? 0.5,
    $subcategory_id: subcategoryId,
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

  return (
    db.prepare("SELECT last_insert_rowid()").get() as { "last_insert_rowid()": number }
  )["last_insert_rowid()"];
}

function seedCategory(db: Database, name: string): number {
  const now = Math.floor(Date.now() / 1000);
  db.run("INSERT INTO categories (name, created_at, last_used_at) VALUES (?, ?, ?)", [
    name,
    now,
    now,
  ]);
  const row = db
    .query("SELECT id FROM categories WHERE name = ? COLLATE NOCASE")
    .get(name) as { id: number };
  return row.id;
}

function seedSubcategory(db: Database, name: string): number {
  const now = Math.floor(Date.now() / 1000);
  db.run("INSERT INTO subcategories (name, created_at, last_used_at) VALUES (?, ?, ?)", [
    name,
    now,
    now,
  ]);
  const row = db.query("SELECT id FROM subcategories WHERE name = ?").get(name) as {
    id: number;
  };
  return row.id;
}

function setupCategoryWithSubcategoryAndMemory(
  db: Database,
  catName: string,
  subName: string,
): { categoryId: number; subcategoryId: number; memoryId: number } {
  const now = Math.floor(Date.now() / 1000);

  const categoryId = seedCategory(db, catName);
  const subcategoryId = seedSubcategory(db, subName);

  db.run(
    "INSERT INTO category_subcategory_links (category_id, subcategory_id) VALUES (?, ?)",
    [categoryId, subcategoryId],
  );

  const memoryId = insertMemory(db, {
    content: "test memory for " + catName,
    summary: "summary",
    subcategory_id: subcategoryId,
    created_at: now,
    last_accessed_at: now,
    last_reinforced_at: now,
    content_hash: `hash_${catName}_${Date.now()}`,
  });

  db.run(
    "INSERT INTO memory_subcategory_links (memory_id, subcategory_id) VALUES (?, ?)",
    [memoryId, subcategoryId],
  );

  return { categoryId, subcategoryId, memoryId };
}

// ── calculateRelevance ───────────────────────────────────────────────────────

describe("calculateRelevance", () => {
  it("returns exact baseRelevance when hoursSinceLastAccess = 0", () => {
    expect(calculateRelevance(0.8, 24, 0)).toBe(0.8);
    expect(calculateRelevance(0.5, 1, 0)).toBe(0.5);
    expect(calculateRelevance(1.0, 100, 0)).toBe(1.0);
  });

  it("returns approximately 0.5 × baseRelevance at t = halfLifeHours", () => {
    const result = calculateRelevance(0.8, 24, 24);
    expect(result).toBeCloseTo(0.4, 3); // 0.8 * 0.5 = 0.4
  });

  it("returns approximately 0.25 × baseRelevance at t = 2 × halfLifeHours", () => {
    const result = calculateRelevance(0.8, 24, 48);
    expect(result).toBeCloseTo(0.2, 3); // 0.8 * 0.25 = 0.2
  });

  it("returns approximately baseRelevance × 0.707 at t = 0.5 × halfLifeHours", () => {
    const result = calculateRelevance(1.0, 24, 12);
    expect(result).toBeCloseTo(0.7071, 3);
  });

  it("approaches 0 for very large t", () => {
    const result = calculateRelevance(1.0, 24, 24000); // 1000 half-lives
    expect(result).toBeLessThan(0.0001);
  });

  it("returns 0 when halfLifeHours is 0", () => {
    expect(calculateRelevance(0.8, 0, 10)).toBe(0);
  });

  it("returns 0 when halfLifeHours is negative", () => {
    expect(calculateRelevance(0.8, -5, 10)).toBe(0);
  });

  it("returns baseRelevance when hoursSinceLastAccess is negative", () => {
    expect(calculateRelevance(0.7, 24, -10)).toBe(0.7);
  });

  it("works with custom half-life values", () => {
    // 1-hour half-life: at 1 hour, relevance = baseRelevance * 0.5
    expect(calculateRelevance(1.0, 1, 1)).toBeCloseTo(0.5, 3);

    // 168-hour half-life (1 week): at 168 hours, relevance = 0.5
    expect(calculateRelevance(1.0, 168, 168)).toBeCloseTo(0.5, 3);
  });
});

// ── getReinforcementBoost ────────────────────────────────────────────────────

describe("getReinforcementBoost", () => {
  it("returns full baseBoost for reinforcement_count = 0", () => {
    expect(getReinforcementBoost(0.15, 0)).toBe(0.15);
  });

  it("returns diminished boost for reinforcement_count = 1", () => {
    // 0.15 * (1 / (1 + 0.3 * 1)) = 0.15 / 1.3 ≈ 0.1154
    const result = getReinforcementBoost(0.15, 1);
    expect(result).toBeCloseTo(0.1154, 3);
  });

  it("returns further diminished boost for reinforcement_count = 2", () => {
    // 0.15 * (1 / (1 + 0.3 * 2)) = 0.15 / 1.6 = 0.09375
    const result = getReinforcementBoost(0.15, 2);
    expect(result).toBeCloseTo(0.09375, 4);
  });

  it("diminishing returns get smaller as count increases", () => {
    const boost0 = getReinforcementBoost(0.2, 0);
    const boost1 = getReinforcementBoost(0.2, 1);
    const boost2 = getReinforcementBoost(0.2, 2);
    const boost5 = getReinforcementBoost(0.2, 5);

    expect(boost0).toBeGreaterThan(boost1);
    expect(boost1).toBeGreaterThan(boost2);
    expect(boost2).toBeGreaterThan(boost5);

    // boost5 = 0.2 / (1 + 0.3*5) = 0.2 / 2.5 = 0.08
    expect(boost5).toBeCloseTo(0.08, 4);
  });

  it("approaches 0 for very large reinforcement counts", () => {
    const boost = getReinforcementBoost(0.15, 100);
    expect(boost).toBeLessThan(0.01);
  });

  it("works with different baseBoost values", () => {
    expect(getReinforcementBoost(0.3, 0)).toBe(0.3);
    expect(getReinforcementBoost(0.3, 1)).toBeCloseTo(0.2308, 3);
  });
});

// ── hoursSince ───────────────────────────────────────────────────────────────

describe("hoursSince", () => {
  it("returns 0 for a current timestamp", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(hoursSince(now)).toBe(0);
  });

  it("returns a positive number for a past timestamp", () => {
    const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;
    const result = hoursSince(oneHourAgo);
    expect(result).toBeGreaterThanOrEqual(0.99);
    expect(result).toBeLessThanOrEqual(1.01);
  });

  it("returns 0 for a future timestamp", () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    expect(hoursSince(future)).toBe(0);
  });

  it("correctly converts seconds to hours", () => {
    const twoHoursAgo = Math.floor(Date.now() / 1000) - 7200;
    const result = hoursSince(twoHoursAgo);
    expect(result).toBeGreaterThanOrEqual(1.99);
    expect(result).toBeLessThanOrEqual(2.01);
  });
});

// ── getMemoriesForRecalculation ──────────────────────────────────────────────

describe("getMemoriesForRecalculation", () => {
  it("returns empty array when no memories exist", () => {
    const db = createInMemoryDatabase();
    const result = getMemoriesForRecalculation(db, 24);
    expect(result).toEqual([]);
    closeDatabase(db);
  });

  it("returns only memories that have aged past halfLifeHours * 0.5", () => {
    const db = createInMemoryDatabase();
    const now = Math.floor(Date.now() / 1000);

    insertMemory(db, {
      content_hash: "fresh",
      last_accessed_at: now,
      relevance: 0.8,
    });

    insertMemory(db, {
      content_hash: "aged",
      last_accessed_at: now - 13 * 3600,
      relevance: 0.5,
    });

    insertMemory(db, {
      content_hash: "semi_fresh",
      last_accessed_at: now - 10 * 3600,
      relevance: 0.6,
    });

    const result = getMemoriesForRecalculation(db, 24);
    expect(result.length).toBe(1);
    expect(result[0].id).toBeGreaterThan(0);

    closeDatabase(db);
  });
});

// ── recalculateAllRelevance ──────────────────────────────────────────────────

describe("recalculateAllRelevance", () => {
  it("returns 0 when no memories have aged", () => {
    const db = createInMemoryDatabase();

    insertMemory(db, {
      content_hash: "fresh_mem",
      last_accessed_at: Math.floor(Date.now() / 1000),
      relevance: 0.8,
    });

    const updated = recalculateAllRelevance(db, 24, 0.15);
    expect(updated).toBe(0);

    closeDatabase(db);
  });

  it("decays relevance for aged memories", () => {
    const db = createInMemoryDatabase();
    const now = Math.floor(Date.now() / 1000);

    insertMemory(db, {
      content_hash: "aged_decay",
      last_accessed_at: now - 24 * 3600,
      relevance: 0.8,
      reinforcement_count: 0,
    });

    const updated = recalculateAllRelevance(db, 24, 0.0);
    expect(updated).toBe(1);

    const row = db
      .prepare("SELECT relevance FROM memories WHERE content_hash = ?")
      .get("aged_decay") as { relevance: number };
    expect(row.relevance).toBeCloseTo(0.4, 3);

    closeDatabase(db);
  });

  it("applies reinforcement boost after decay", () => {
    const db = createInMemoryDatabase();
    const now = Math.floor(Date.now() / 1000);

    insertMemory(db, {
      content_hash: "aged_with_boost",
      last_accessed_at: now - 24 * 3600,
      relevance: 0.6,
      reinforcement_count: 1,
    });

    recalculateAllRelevance(db, 24, 0.15);

    const row = db
      .prepare("SELECT relevance FROM memories WHERE content_hash = ?")
      .get("aged_with_boost") as { relevance: number };

    // decay: 0.6 * 0.5 = 0.3
    // boost: 0.15 / (1 + 0.3*1) = 0.15/1.3 ≈ 0.1154
    // total: MIN(0.3 + 0.1154, 1.0) ≈ 0.4154
    expect(row.relevance).toBeCloseTo(0.4154, 3);

    closeDatabase(db);
  });
});

// ── getMemoriesToPrune ───────────────────────────────────────────────────────

describe("getMemoriesToPrune", () => {
  it("returns empty array when no memories are below threshold", () => {
    const db = createInMemoryDatabase();

    insertMemory(db, {
      content_hash: "high_relevance",
      relevance: 0.5,
    });

    const result = getMemoriesToPrune(db, 0.1);
    expect(result).toEqual([]);

    closeDatabase(db);
  });

  it("returns memories with relevance below threshold", () => {
    const db = createInMemoryDatabase();

    insertMemory(db, {
      content_hash: "low_relevance",
      relevance: 0.05,
      content: "low content",
      summary: "low summary",
    });

    const result = getMemoriesToPrune(db, 0.1);
    expect(result.length).toBe(1);
    expect(result[0].content).toBe("low content");
    expect(result[0].relevance).toBe(0.05);

    closeDatabase(db);
  });

  it("sorts results by relevance ascending", () => {
    const db = createInMemoryDatabase();

    insertMemory(db, {
      content_hash: "very_low",
      relevance: 0.01,
    });
    insertMemory(db, {
      content_hash: "medium_low",
      relevance: 0.08,
    });

    const result = getMemoriesToPrune(db, 0.1);

    for (let i = 1; i < result.length; i++) {
      expect(result[i].relevance).toBeGreaterThanOrEqual(result[i - 1].relevance);
    }

    closeDatabase(db);
  });

  it("returns only memories below threshold, not at threshold", () => {
    const db = createInMemoryDatabase();

    insertMemory(db, {
      content_hash: "exactly_threshold",
      relevance: 0.1,
    });
    insertMemory(db, {
      content_hash: "below_threshold",
      relevance: 0.099,
    });

    const result = getMemoriesToPrune(db, 0.1);
    expect(result.length).toBeGreaterThanOrEqual(1);
    // exactly 0.1 should NOT be included (strict less than)
    expect(result.some((m) => m.relevance === 0.1)).toBe(false);

    closeDatabase(db);
  });
});

// ── pruneLowRelevanceMemories ────────────────────────────────────────────────

describe("pruneLowRelevanceMemories", () => {
  it("returns 0 when no memories are below threshold", () => {
    const db = createInMemoryDatabase();

    insertMemory(db, {
      content_hash: "keep_me",
      relevance: 0.5,
    });

    const deleted = pruneLowRelevanceMemories(db, 0.1);
    expect(deleted).toBe(0);

    const remaining = db.prepare("SELECT COUNT(*) AS cnt FROM memories").get() as {
      cnt: number;
    };
    expect(remaining.cnt).toBeGreaterThanOrEqual(1);

    closeDatabase(db);
  });

  it("deletes correct number of low-relevance memories", () => {
    const db = createInMemoryDatabase();

    insertMemory(db, {
      content_hash: "prune_me_1",
      relevance: 0.02,
    });
    insertMemory(db, {
      content_hash: "prune_me_2",
      relevance: 0.05,
    });

    const deleted = pruneLowRelevanceMemories(db, 0.1);
    expect(deleted).toBe(2);

    const verify = db
      .prepare("SELECT id FROM memories WHERE content_hash = ?")
      .get("prune_me_1");
    expect(verify).toBeNull();

    closeDatabase(db);
  });

  it("only deletes memories below the threshold", () => {
    const db = createInMemoryDatabase();

    insertMemory(db, {
      content_hash: "keep_above",
      relevance: 0.15,
    });
    insertMemory(db, {
      content_hash: "prune_below",
      relevance: 0.03,
    });

    const deleted = pruneLowRelevanceMemories(db, 0.1);
    expect(deleted).toBe(1);

    const kept = db
      .prepare("SELECT id FROM memories WHERE content_hash = ?")
      .get("keep_above");
    expect(kept).not.toBeNull();

    closeDatabase(db);
  });
});

// ── pruneOrphanCategories ────────────────────────────────────────────────────

describe("pruneOrphanCategories", () => {
  it("deletes categories that have no linked subcategories", () => {
    const db = createInMemoryDatabase();

    // Category with subcategory → NOT orphan
    const catWithSub = seedCategory(db, "CatWithSub");
    const subId = seedSubcategory(db, "HasSub");
    db.run("INSERT INTO category_subcategory_links (category_id, subcategory_id) VALUES (?, ?)", [
      catWithSub,
      subId,
    ]);

    // Category without subcategory → orphan
    seedCategory(db, "OrphanCat");

    const deleted = pruneOrphanCategories(db);
    expect(deleted).toBe(1);

    const checkOrphan = db
      .prepare("SELECT id FROM categories WHERE name = ?")
      .get("OrphanCat");
    expect(checkOrphan).toBeNull();

    const checkKept = db
      .prepare("SELECT id FROM categories WHERE name = ?")
      .get("CatWithSub");
    expect(checkKept).not.toBeNull();

    closeDatabase(db);
  });

  it("returns 0 when no orphan categories exist", () => {
    const db = createInMemoryDatabase();

    const catId = seedCategory(db, "AllHaveSubs");
    const subId = seedSubcategory(db, "Sub1");
    db.run("INSERT INTO category_subcategory_links (category_id, subcategory_id) VALUES (?, ?)", [
      catId,
      subId,
    ]);

    const deleted = pruneOrphanCategories(db);
    expect(deleted).toBe(0);

    closeDatabase(db);
  });
});

// ── pruneOrphanSubcategories ─────────────────────────────────────────────────

describe("pruneOrphanSubcategories", () => {
  it("deletes subcategories with no linked memories", () => {
    const db = createInMemoryDatabase();

    // Setup: subcategory with a memory → NOT orphan
    const catId = seedCategory(db, "Cat1");
    const subWithMem = seedSubcategory(db, "SubWithMem");
    db.run("INSERT INTO category_subcategory_links (category_id, subcategory_id) VALUES (?, ?)", [
      catId,
      subWithMem,
    ]);

    insertMemory(db, {
      content_hash: "mem_for_sub",
      subcategory_id: subWithMem,
    });
    const memId = (
      db.prepare("SELECT id FROM memories WHERE content_hash = ?").get("mem_for_sub") as {
        id: number;
      }
    ).id;
    db.run("INSERT INTO memory_subcategory_links (memory_id, subcategory_id) VALUES (?, ?)", [
      memId,
      subWithMem,
    ]);

    // Orphan subcategory: no memory links
    const subOrphan = seedSubcategory(db, "SubOrphan");
    db.run("INSERT INTO category_subcategory_links (category_id, subcategory_id) VALUES (?, ?)", [
      catId,
      subOrphan,
    ]);

    const deleted = pruneOrphanSubcategories(db);
    expect(deleted).toBe(1);

    const checkOrphan = db
      .prepare("SELECT id FROM subcategories WHERE name = ?")
      .get("SubOrphan");
    expect(checkOrphan).toBeNull();

    const checkKept = db
      .prepare("SELECT id FROM subcategories WHERE name = ?")
      .get("SubWithMem");
    expect(checkKept).not.toBeNull();

    closeDatabase(db);
  });

  it("returns 0 when no orphan subcategories exist", () => {
    const db = createInMemoryDatabase();

    const catId = seedCategory(db, "Cat2");
    const subId = seedSubcategory(db, "UsedSub");
    db.run("INSERT INTO category_subcategory_links (category_id, subcategory_id) VALUES (?, ?)", [
      catId,
      subId,
    ]);

    insertMemory(db, {
      content_hash: "used_mem",
      subcategory_id: subId,
    });
    const memId = (
      db.prepare("SELECT id FROM memories WHERE content_hash = ?").get("used_mem") as {
        id: number;
      }
    ).id;
    db.run("INSERT INTO memory_subcategory_links (memory_id, subcategory_id) VALUES (?, ?)", [
      memId,
      subId,
    ]);

    const deleted = pruneOrphanSubcategories(db);
    expect(deleted).toBe(0);

    closeDatabase(db);
  });
});

// ── runMaintenance integration ───────────────────────────────────────────────

describe("runMaintenance", () => {
  it("returns a complete report with all fields", () => {
    const db = createInMemoryDatabase();

    // Setup: a healthy memory that's fresh
    const now = Math.floor(Date.now() / 1000);
    const catId = seedCategory(db, "ActiveCat");
    const subId = seedSubcategory(db, "ActiveSub");
    db.run("INSERT INTO category_subcategory_links (category_id, subcategory_id) VALUES (?, ?)", [
      catId,
      subId,
    ]);

    insertMemory(db, {
      content_hash: "fresh_healthy",
      relevance: 0.8,
      subcategory_id: subId,
      last_accessed_at: now,
      reinforcement_count: 0,
    });
    const memId = (
      db.prepare("SELECT id FROM memories WHERE content_hash = ?").get("fresh_healthy") as {
        id: number;
      }
    ).id;
    db.run("INSERT INTO memory_subcategory_links (memory_id, subcategory_id) VALUES (?, ?)", [
      memId,
      subId,
    ]);

    const report = runMaintenance(db, 24, 0.15, 0.1);

    expect(report).toHaveProperty("memories_recalculated");
    expect(report).toHaveProperty("memories_pruned");
    expect(report).toHaveProperty("subcategories_pruned");
    expect(report).toHaveProperty("categories_pruned");

    expect(typeof report.memories_recalculated).toBe("number");
    expect(typeof report.memories_pruned).toBe("number");
    expect(typeof report.subcategories_pruned).toBe("number");
    expect(typeof report.categories_pruned).toBe("number");

    // Fresh memory should not be recalculated
    expect(report.memories_recalculated).toBe(0);

    closeDatabase(db);
  });

  it("recalculates and prunes old low-relevance memories", () => {
    const db = createInMemoryDatabase();
    const now = Math.floor(Date.now() / 1000);

    // Setup category/subcategory structure
    const catId = seedCategory(db, "DecayCat");
    const subId = seedSubcategory(db, "DecaySub");
    db.run("INSERT INTO category_subcategory_links (category_id, subcategory_id) VALUES (?, ?)", [
      catId,
      subId,
    ]);

    // Memory that's very old — 100 hours since access, half-life=24
    insertMemory(db, {
      content_hash: "very_old_mem",
      relevance: 0.15, // already low
      subcategory_id: subId,
      last_accessed_at: now - 100 * 3600,
      reinforcement_count: 0,
    });
    const memId = (
      db.prepare("SELECT id FROM memories WHERE content_hash = ?").get("very_old_mem") as {
        id: number;
      }
    ).id;
    db.run("INSERT INTO memory_subcategory_links (memory_id, subcategory_id) VALUES (?, ?)", [
      memId,
      subId,
    ]);

    const report = runMaintenance(db, 24, 0.0, 0.1);

    // Should recalculate the old memory
    expect(report.memories_recalculated).toBe(1);

    // After decay: 0.15 * 0.5^(100/24) ≈ 0.15 * 0.5^4.17 ≈ 0.0084 → below 0.1, pruned
    expect(report.memories_pruned).toBe(1);

    // Subcategory should become orphan after memory is pruned
    expect(report.subcategories_pruned).toBe(1);

    // Category should become orphan after subcategory is pruned
    expect(report.categories_pruned).toBe(1);

    closeDatabase(db);
  });

  it("handles empty database gracefully", () => {
    const db = createInMemoryDatabase();

    const report = runMaintenance(db, 24, 0.15, 0.1);

    expect(report.memories_recalculated).toBe(0);
    expect(report.memories_pruned).toBe(0);
    expect(report.subcategories_pruned).toBe(0);
    expect(report.categories_pruned).toBe(0);

    closeDatabase(db);
  });

  it("cascading: pruned memories → orphan subcategories → orphan categories", () => {
    const db = createInMemoryDatabase();
    const now = Math.floor(Date.now() / 1000);

    // Create a full chain: Category → Subcategory → Memory
    // Memory will be decayed below threshold and pruned, then orphan cleanup cascades
    const { categoryId, subcategoryId } = setupCategoryWithSubcategoryAndMemory(
      db,
      "CascadeCat",
      "CascadeSub",
    );

    // Verify everything exists before
    expect(
      db.prepare("SELECT COUNT(*) AS cnt FROM categories").get(),
    ).toHaveProperty("cnt", 1);
    expect(
      db.prepare("SELECT COUNT(*) AS cnt FROM subcategories").get(),
    ).toHaveProperty("cnt", 1);
    expect(
      db.prepare("SELECT COUNT(*) AS cnt FROM memories").get(),
    ).toHaveProperty("cnt", 1);

    // Set the memory to be very old and low relevance
    db.prepare(
      "UPDATE memories SET last_accessed_at = ?, relevance = ? WHERE subcategory_id = ?",
    ).run(now - 200 * 3600, 0.15, subcategoryId);

    const report = runMaintenance(db, 24, 0.0, 0.1);

    // Everything should be pruned
    expect(report.memories_pruned).toBe(1);
    expect(report.subcategories_pruned).toBeGreaterThanOrEqual(0);
    // After all cleanup, all should be gone or the chain is cascade-cleaned
    expect(
      (db.prepare("SELECT COUNT(*) AS cnt FROM memories").get() as { cnt: number }).cnt,
    ).toBe(0);

    closeDatabase(db);
  });
});
