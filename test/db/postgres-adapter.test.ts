import { describe, it, expect } from "bun:test";

let pgAvailable = false;
let PG_ENABLED = false;

try {
  await import("pg");
  pgAvailable = true;

  if (process.env.CI) {
    PG_ENABLED = !!process.env.DATABASE_URL;
  } else {
    PG_ENABLED = !!process.env.DATABASE_URL || !!process.env.PG_URL;
  }
} catch {
  pgAvailable = false;
}

import { PostgresAdapter } from "../../src/db/postgres-adapter";

function makeConfig(overrides?: Record<string, unknown>) {
  return {
    db: {
      type: "postgres" as const,
      sqlite_path: ":memory:",
      postgres_url: process.env.DATABASE_URL || process.env.PG_URL || "postgresql://localhost:5432/neuro_memory_test",
      ...((overrides?.db as Record<string, unknown>) ?? {}),
    },
    memory: {
      max_entries: 5000,
      max_token_per_entry: 1024,
      max_categories: 50,
      max_subcategories_per_category: 100,
      max_subcategory_links: 3,
      max_subcategory_per_memory: 10,
      ...((overrides?.memory as Record<string, unknown>) ?? {}),
    },
    retrieval: {
      relevance_threshold: 0.75,
      max_results: 3,
      timeout_ms: 3000,
      ...((overrides?.retrieval as Record<string, unknown>) ?? {}),
    },
    ebbinghaus: {
      half_life_hours: 24,
      min_relevance: 0.1,
      reinforcement_boost: 0.15,
      prune_interval_hours: 1,
      ...((overrides?.ebbinghaus as Record<string, unknown>) ?? {}),
    },
    summarization: {
      model: "",
      prompt_template: "",
    },
  };
}

describe("PostgresAdapter (structural)", () => {
  it("class exists and has constructor", () => {
    const cfg = makeConfig();
    const adapter = new PostgresAdapter(cfg);
    expect(adapter).toBeInstanceOf(PostgresAdapter);
  });

  it("implements DBAdapter interface", () => {
    const cfg = makeConfig();
    const adapter = new PostgresAdapter(cfg);

    const requiredMethods: string[] = [
      "init",
      "close",
      "createCategory",
      "getAllCategories",
      "getCategoryById",
      "findCategoryByName",
      "findOrCreateCategory",
      "getCategoryCount",
      "deleteCategory",
      "getOrphanCategories",
      "createSubcategory",
      "getSubcategoriesByCategory",
      "linkSubcategoryToCategory",
      "getSubcategoryCount",
      "deleteSubcategory",
      "insertMemory",
      "getMemoryById",
      "searchMemories",
      "getMemoryCount",
      "deleteMemory",
      "updateRelevance",
      "updateLastAccessed",
      "getLowestRelevanceMemories",
      "isAtCap",
      "getMemoriesForRecalculation",
      "recalculateAllRelevance",
      "getMemoriesToPrune",
      "pruneLowRelevanceMemories",
      "pruneOrphanSubcategories",
      "pruneOrphanCategories",
      "runMaintenance",
    ];

    for (const method of requiredMethods) {
      expect(typeof (adapter as any)[method]).toBe("function");
    }
  });

  it("throws when using adapter before init", async () => {
    const cfg = makeConfig();
    const adapter = new PostgresAdapter(cfg);
    await expect(adapter.getAllCategories()).rejects.toThrow(/not initialized/);
  });
});

describe("PostgresAdapter (integration)", () => {
  const skip = !pgAvailable || !PG_ENABLED;

  if (skip) {
    it.skip("integration tests skipped: pg not installed or no PG connection available", () => {});

    return;
  }

  let adapter: PostgresAdapter;

  afterAll(async () => {
    if (adapter) {
      try { await adapter.close(); } catch {}
    }
  });

  it("init connects and close cleans up", async () => {
    const cfg = makeConfig();
    adapter = new PostgresAdapter(cfg);
    await adapter.init();
    const cats = await adapter.getAllCategories();
    expect(cats).toEqual([]);
    await adapter.close();
  });

  it("init can be called with config override", async () => {
    const cfg = makeConfig();
    const cfg2 = makeConfig();
    cfg2.memory.max_entries = 100;
    const a = new PostgresAdapter(cfg);
    await a.init(cfg2);
    expect(cfg2.memory.max_entries).toBe(100);
    await a.close();
  });

  it("createCategory and getAllCategories work", async () => {
    const cfg = makeConfig();
    const a = new PostgresAdapter(cfg);
    await a.init();

    const id = await a.createCategory("PG_Test");
    expect(id).toBeGreaterThan(0);

    const cats = await a.getAllCategories();
    expect(cats.some((c) => c.id === id)).toBe(true);
    expect(cats.find((c) => c.id === id)!.name).toBe("PG_Test");

    await a.close();
  });

  it("createCategory deduplicates case-insensitively", async () => {
    const cfg = makeConfig();
    const a = new PostgresAdapter(cfg);
    await a.init();

    const id1 = await a.createCategory("PgCase");
    const id2 = await a.createCategory("PGCASE");
    expect(id2).toBe(id1);

    await a.close();
  });

  it("findCategoryByName works case-insensitively", async () => {
    const cfg = makeConfig();
    const a = new PostgresAdapter(cfg);
    await a.init();

    await a.createCategory("PgFindMe");
    const cat = await a.findCategoryByName("pgfindme");
    expect(cat).not.toBeNull();
    expect(cat!.name).toBe("PgFindMe");

    await a.close();
  });

  it("findOrCreateCategory returns created=true for new", async () => {
    const cfg = makeConfig();
    const a = new PostgresAdapter(cfg);
    await a.init();

    const r = await a.findOrCreateCategory("PgNewCat");
    expect(r.created).toBe(true);
    expect(r.id).toBeGreaterThan(0);

    await a.close();
  });

  it("subcategories link correctly", async () => {
    const cfg = makeConfig();
    const a = new PostgresAdapter(cfg);
    await a.init();

    const catId = await a.createCategory("PgSubCat");
    const sub = await a.createSubcategory("PgSub", catId);
    expect(sub.created).toBe(true);
    expect(sub.id).toBeGreaterThan(0);

    const subs = await a.getSubcategoriesByCategory(catId);
    expect(subs.length).toBe(1);
    expect(subs[0].name).toBe("PgSub");

    await a.close();
  });

  it("insertMemory and getMemoryById work", async () => {
    const cfg = makeConfig();
    const a = new PostgresAdapter(cfg);
    await a.init();

    const catId = await a.createCategory("PgMemCat");
    const subId = (await a.createSubcategory("PgMemSub", catId)).id;

    const r = await a.insertMemory({
      content: "PG test content",
      summary: "PG test summary",
      contentHash: "pg_hash_test",
      relevance: 0.75,
      subcategoryId: subId,
    });
    expect(r.created).toBe(true);
    expect(r.id).toBeGreaterThan(0);

    const mem = await a.getMemoryById(r.id);
    expect(mem).not.toBeNull();
    expect(mem!.content).toBe("PG test content");

    await a.close();
  });

  it("insertMemory detects duplicate and reinforces", async () => {
    const cfg = makeConfig();
    const a = new PostgresAdapter(cfg);
    await a.init();

    const catId = await a.createCategory("PgDupCat");
    const subId = (await a.createSubcategory("PgDupSub", catId)).id;

    const hash = "pg_dup_hash_test";
    const r1 = await a.insertMemory({
      content: "original",
      summary: "original",
      contentHash: hash,
      relevance: 0.6,
      subcategoryId: subId,
    });
    expect(r1.created).toBe(true);

    const r2 = await a.insertMemory({
      content: "different text",
      summary: "different",
      contentHash: hash,
      relevance: 0.5,
      subcategoryId: subId,
    });
    expect(r2.id).toBe(r1.id);
    expect(r2.created).toBe(false);
    expect(r2.reinforced).toBe(true);

    await a.close();
  });

  it("searchMemories filters by keyword", async () => {
    const cfg = makeConfig();
    const a = new PostgresAdapter(cfg);
    await a.init();

    const catId = await a.createCategory("PgSearchCat");
    const subId = (await a.createSubcategory("PgSearchSub", catId)).id;

    await a.insertMemory({
      content: "elephant facts",
      summary: "elephants",
      contentHash: "pg_hash_elephant",
      relevance: 0.9,
      subcategoryId: subId,
    });
    await a.insertMemory({
      content: "tiger facts",
      summary: "tigers",
      contentHash: "pg_hash_tiger",
      relevance: 0.8,
      subcategoryId: subId,
    });

    const results = await a.searchMemories({ keyword: "elephant", limit: 10 });
    expect(results.length).toBe(1);
    expect(results[0].content_hash).toBe("pg_hash_elephant");

    await a.close();
  });

  it("searchMemories with ILIKE is case-insensitive", async () => {
    const cfg = makeConfig();
    const a = new PostgresAdapter(cfg);
    await a.init();

    const catId = await a.createCategory("PgIlikeCat");
    const subId = (await a.createSubcategory("PgIlikeSub", catId)).id;

    await a.insertMemory({
      content: "UPPERCASE WORD",
      summary: "uppercase",
      contentHash: "pg_hash_ilike_upper",
      relevance: 0.7,
      subcategoryId: subId,
    });

    const results = await a.searchMemories({ keyword: "uppercase", limit: 10 });
    expect(results.length).toBe(1);

    await a.close();
  });

  it("updateRelevance clamps between 0 and 1", async () => {
    const cfg = makeConfig();
    const a = new PostgresAdapter(cfg);
    await a.init();

    const catId = await a.createCategory("PgRelCat");
    const subId = (await a.createSubcategory("PgRelSub", catId)).id;

    const r = await a.insertMemory({
      content: "rel clamp test",
      summary: "rel clamp",
      contentHash: "pg_hash_rel_clamp",
      relevance: 0.5,
      subcategoryId: subId,
    });

    await a.updateRelevance(r.id, 1.5);
    const mem1 = await a.getMemoryById(r.id);
    expect(mem1!.relevance).toBe(1.0);

    await a.updateRelevance(r.id, -0.5);
    const mem2 = await a.getMemoryById(r.id);
    expect(mem2!.relevance).toBe(0.0);

    await a.close();
  });

  it("updateLastAccessed updates timestamp", async () => {
    const cfg = makeConfig();
    const a = new PostgresAdapter(cfg);
    await a.init();

    const catId = await a.createCategory("PgAccessCat");
    const subId = (await a.createSubcategory("PgAccessSub", catId)).id;

    const r = await a.insertMemory({
      content: "access pg test",
      summary: "access pg",
      contentHash: "pg_hash_access",
      relevance: 0.5,
      subcategoryId: subId,
    });

    const before = await a.getMemoryById(r.id);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await a.updateLastAccessed(r.id);
    const after = await a.getMemoryById(r.id);
    expect(after!.last_accessed_at).toBeGreaterThan(before!.last_accessed_at);

    await a.close();
  });

  it("getLowestRelevanceMemories returns ascending", async () => {
    const cfg = makeConfig();
    const a = new PostgresAdapter(cfg);
    await a.init();

    const catId = await a.createCategory("PgLowRelCat");
    const subId = (await a.createSubcategory("PgLowRelSub", catId)).id;

    await a.insertMemory({ content: "c", summary: "c", contentHash: "pg_hash_low_c", relevance: 0.4, subcategoryId: subId });
    await a.insertMemory({ content: "a", summary: "a", contentHash: "pg_hash_low_a", relevance: 0.1, subcategoryId: subId });
    await a.insertMemory({ content: "b", summary: "b", contentHash: "pg_hash_low_b", relevance: 0.2, subcategoryId: subId });

    const mems = await a.getLowestRelevanceMemories(5);
    for (let i = 1; i < mems.length; i++) {
      expect(mems[i].relevance).toBeGreaterThanOrEqual(mems[i - 1].relevance);
    }

    await a.close();
  });

  it("isAtCap works", async () => {
    const cfg = makeConfig();
    cfg.memory.max_entries = 999999;
    const a = new PostgresAdapter(cfg);
    await a.init();

    expect(await a.isAtCap()).toBe(false);
    await a.close();
  });

  it("maintenance methods return correct types", async () => {
    const cfg = makeConfig();
    const a = new PostgresAdapter(cfg);
    await a.init();

    const mems = await a.getMemoriesForRecalculation(24);
    expect(Array.isArray(mems)).toBe(true);

    const updated = await a.recalculateAllRelevance(24, 0.15);
    expect(typeof updated).toBe("number");

    const toPrune = await a.getMemoriesToPrune(0.1);
    expect(Array.isArray(toPrune)).toBe(true);

    const pruned = await a.pruneLowRelevanceMemories(0.001);
    expect(typeof pruned).toBe("number");

    const orphanSubs = await a.pruneOrphanSubcategories();
    expect(typeof orphanSubs).toBe("number");

    const orphanCats = await a.pruneOrphanCategories();
    expect(typeof orphanCats).toBe("number");

    const report = await a.runMaintenance(24, 0.15, 0.1);
    expect(report).toHaveProperty("memories_recalculated");
    expect(report).toHaveProperty("memories_pruned");
    expect(report).toHaveProperty("subcategories_pruned");
    expect(report).toHaveProperty("categories_pruned");

    await a.close();
  });

  it("delete operations clean up", async () => {
    const cfg = makeConfig();
    const a = new PostgresAdapter(cfg);
    await a.init();

    const catId = await a.createCategory("PgDelCat");
    const subId = (await a.createSubcategory("PgDelSub", catId)).id;

    const r = await a.insertMemory({
      content: "to delete pg",
      summary: "delete pg",
      contentHash: "pg_hash_delete_mem",
      relevance: 0.5,
      subcategoryId: subId,
    });

    await a.deleteMemory(r.id);
    expect(await a.getMemoryById(r.id)).toBeNull();

    await a.deleteSubcategory(subId);
    expect((await a.getSubcategoriesByCategory(catId)).length).toBe(0);

    await a.deleteCategory(catId);
    expect(await a.getCategoryById(catId)).toBeNull();

    await a.close();
  });
});
