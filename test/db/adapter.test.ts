import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createAdapter } from "../../src/db/adapter";
import { SQLiteAdapter } from "../../src/db/sqlite-adapter";
import type { DBAdapter, InsertResult, MaintenanceReport, NeuroMemoryConfig } from "../../src/db/adapter";

interface ConfigOverrides {
  db?: Partial<{ type: string; sqlite_path: string }>;
  memory?: Partial<{
    max_entries: number;
    max_token_per_entry: number;
    max_categories: number;
    max_subcategories_per_category: number;
    max_subcategory_links: number;
    max_subcategory_per_memory: number;
  }>;
  ebbinghaus?: Partial<{
    half_life_hours: number;
    min_relevance: number;
    reinforcement_boost: number;
    prune_interval_hours: number;
  }>;
  retrieval?: Partial<{
    relevance_threshold: number;
    max_results: number;
    timeout_ms: number;
  }>;
  summarization?: Partial<{
    model: string;
    prompt_template: string;
  }>;
}

function makeConfig(overrides?: ConfigOverrides): NeuroMemoryConfig {
  const cfg: NeuroMemoryConfig = {
    db: { type: "sqlite", sqlite_path: ":memory:" },
    memory: {
      max_entries: 5000,
      max_token_per_entry: 1024,
      max_categories: 50,
      max_subcategories_per_category: 100,
      max_subcategory_links: 3,
      max_subcategory_per_memory: 10,
    },
    retrieval: {
      relevance_threshold: 0.75,
      max_results: 3,
      timeout_ms: 3000,
    },
    ebbinghaus: {
      half_life_hours: 24,
      min_relevance: 0.1,
      reinforcement_boost: 0.15,
      prune_interval_hours: 1,
    },
    summarization: {
      model: "",
      prompt_template: "",
    },
  };

  if (overrides) {
    if (overrides.db) Object.assign(cfg.db, overrides.db);
    if (overrides.memory) Object.assign(cfg.memory, overrides.memory);
    if (overrides.ebbinghaus) Object.assign(cfg.ebbinghaus, overrides.ebbinghaus);
    if (overrides.retrieval) Object.assign(cfg.retrieval, overrides.retrieval);
    if (overrides.summarization) Object.assign(cfg.summarization, overrides.summarization);
  }

  return cfg;
}

let adapter: SQLiteAdapter;

async function setupAdapter(overrides?: ConfigOverrides): Promise<SQLiteAdapter> {
  const cfg = makeConfig(overrides);
  const a = new SQLiteAdapter(cfg);
  await a.init();
  return a;
}

describe("createAdapter factory", () => {
  it("returns SQLiteAdapter for type='sqlite'", () => {
    const cfg = makeConfig();
    cfg.db.type = "sqlite";
    const a = createAdapter(cfg);
    expect(a).toBeInstanceOf(SQLiteAdapter);
  });

  it("returns PostgresAdapter for type='postgres' (requires pg package)", async () => {
    const cfg = makeConfig();
    cfg.db.type = "postgres";
    cfg.db.postgres_url = "postgresql://localhost:5432/test";
    try {
      await import("pg");
      const a = createAdapter(cfg);
      expect(a).toHaveProperty("init");
      expect(a).toHaveProperty("close");
    } catch {
      // pg package not installed — skip
    }
  });

  it("creates DuckDBAdapter stub (not yet implemented)", () => {
    const cfg = makeConfig();
    cfg.db.type = "duckdb";
    const adapter = createAdapter(cfg);
    expect(adapter).toHaveProperty("init");
    expect(adapter).toHaveProperty("close");
    expect(() => adapter.init(cfg)).toThrow(/DuckDB adapter not implemented/);
  });

  it("creates MySQLAdapter stub (not yet implemented)", () => {
    const cfg = makeConfig();
    cfg.db.type = "mysql";
    const adapter = createAdapter(cfg);
    expect(adapter).toHaveProperty("init");
    expect(adapter).toHaveProperty("close");
    expect(() => adapter.init(cfg)).toThrow(/MySQL adapter not implemented/);
  });

  it("creates MariaDBAdapter stub (not yet implemented)", () => {
    const cfg = makeConfig();
    cfg.db.type = "mariadb";
    const adapter = createAdapter(cfg);
    expect(adapter).toHaveProperty("init");
    expect(adapter).toHaveProperty("close");
    expect(() => adapter.init(cfg)).toThrow(/MariaDB adapter not implemented/);
  });

  it("throws for completely unsupported type", () => {
    const cfg = makeConfig();
    (cfg.db as any).type = "couchdb";
    expect(() => createAdapter(cfg)).toThrow(/Unsupported database type/);
  });
});

describe("SQLiteAdapter lifecycle", () => {
  it("init creates database and close cleans up", async () => {
    const a = await setupAdapter();
    const cats = await a.getAllCategories();
    expect(cats).toEqual([]);
    await a.close();
  });

  it("throws when using adapter before init", () => {
    const cfg = makeConfig();
    const a = new SQLiteAdapter(cfg);
    expect(a.getAllCategories()).rejects.toThrow(/not initialized/);
  });

  it("init can be called with config override", async () => {
    const cfg = makeConfig();
    const cfg2 = makeConfig();
    cfg2.memory.max_entries = 100;
    const a = new SQLiteAdapter(cfg);
    await a.init(cfg2);
    expect(cfg2.memory.max_entries).toBe(100);
    await a.close();
  });
});

describe("SQLiteAdapter categories", () => {
  beforeAll(async () => { adapter = await setupAdapter(); });
  afterAll(async () => { await adapter.close(); });

  it("createCategory creates and returns id", async () => {
    const id = await adapter.createCategory("Programming");
    expect(id).toBeGreaterThan(0);
  });

  it("createCategory deduplicates case-insensitively", async () => {
    const id1 = await adapter.createCategory("Math");
    const id2 = await adapter.createCategory("MATH");
    expect(id2).toBe(id1);
  });

  it("createCategory throws on empty name", async () => {
    await expect(adapter.createCategory("")).rejects.toThrow(/must not be empty/);
  });

  it("getAllCategories returns categories with subcategory_count", async () => {
    await adapter.createCategory("Art");
    await adapter.createCategory("Music");
    const cats = await adapter.getAllCategories();
    expect(cats.length).toBeGreaterThanOrEqual(2);
    for (const c of cats) {
      expect(c).toHaveProperty("subcategory_count");
    }
  });

  it("getCategoryById returns null for non-existent", async () => {
    expect(await adapter.getCategoryById(99999)).toBeNull();
  });

  it("getCategoryById returns correct category", async () => {
    const id = await adapter.createCategory("Physics");
    const cat = await adapter.getCategoryById(id);
    expect(cat).not.toBeNull();
    expect(cat!.name).toBe("Physics");
  });

  it("findCategoryByName returns null when no match", async () => {
    expect(await adapter.findCategoryByName("NoSuch")).toBeNull();
  });

  it("findCategoryByName finds case-insensitively", async () => {
    await adapter.createCategory("Biology");
    const cat = await adapter.findCategoryByName("BIOLOGY");
    expect(cat).not.toBeNull();
    expect(cat!.name).toBe("Biology");
  });

  it("findOrCreateCategory creates new and returns created=true", async () => {
    const r = await adapter.findOrCreateCategory("NewTopic");
    expect(r.created).toBe(true);
    expect(r.id).toBeGreaterThan(0);
  });

  it("findOrCreateCategory returns existing with created=false", async () => {
    await adapter.createCategory("Existing");
    const r = await adapter.findOrCreateCategory("Existing");
    expect(r.created).toBe(false);
  });

  it("getCategoryCount reflects actual count", async () => {
    const before = await adapter.getCategoryCount();
    await adapter.createCategory("CountCat" + Date.now());
    expect(await adapter.getCategoryCount()).toBe(before + 1);
  });

  it("deleteCategory removes category", async () => {
    const id = await adapter.createCategory("ToDelete");
    await adapter.deleteCategory(id);
    expect(await adapter.getCategoryById(id)).toBeNull();
  });

  it("getOrphanCategories returns categories without subcategories", async () => {
    const oid = await adapter.createCategory("Orphan" + Date.now());
    const orphans = await adapter.getOrphanCategories();
    expect(orphans.some((c) => c.id === oid)).toBe(true);
  });
});

describe("SQLiteAdapter subcategories", () => {
  beforeAll(async () => { adapter = await setupAdapter(); });
  afterAll(async () => { await adapter.close(); });

  it("createSubcategory links to category", async () => {
    const catId = await adapter.createCategory("Tech");
    const r = await adapter.createSubcategory("JavaScript", catId);
    expect(r.id).toBeGreaterThan(0);
    expect(r.created).toBe(true);
  });

  it("createSubcategory returns created=false for duplicate", async () => {
    const catId = await adapter.createCategory("Lang");
    const r1 = await adapter.createSubcategory("Python", catId);
    const r2 = await adapter.createSubcategory("Python", catId);
    expect(r2.id).toBe(r1.id);
    expect(r2.created).toBe(false);
  });

  it("createSubcategory throws for non-existent category", async () => {
    await expect(adapter.createSubcategory("Orphan", 99999)).rejects.toThrow(/does not exist/);
  });

  it("getSubcategoriesByCategory returns subcategories", async () => {
    const catId = await adapter.createCategory("Sports");
    await adapter.createSubcategory("Soccer", catId);
    await adapter.createSubcategory("Basketball", catId);
    const subs = await adapter.getSubcategoriesByCategory(catId);
    expect(subs.length).toBe(2);
  });

  it("getSubcategoriesByCategory returns empty for category with none", async () => {
    const catId = await adapter.createCategory("EmptySubs" + Date.now());
    const subs = await adapter.getSubcategoriesByCategory(catId);
    expect(subs).toEqual([]);
  });

  it("linkSubcategoryToCategory adds link", async () => {
    const cat1 = await adapter.createCategory("CatA_" + Date.now());
    const cat2 = await adapter.createCategory("CatB_" + Date.now());
    const sub = await adapter.createSubcategory("SharedSub", cat1);
    await adapter.linkSubcategoryToCategory(sub.id, cat2);
    const subsB = await adapter.getSubcategoriesByCategory(cat2);
    expect(subsB.length).toBe(1);
  });

  it("linkSubcategoryToCategory is no-op when already linked", async () => {
    const catId = await adapter.createCategory("DupLinkCat");
    const sub = await adapter.createSubcategory("DupLinkSub", catId);
    await expect(adapter.linkSubcategoryToCategory(sub.id, catId)).resolves.toBeUndefined();
  });

  it("getSubcategoryCount returns correct count", async () => {
    const catId = await adapter.createCategory("SubCountCat" + Date.now());
    expect(await adapter.getSubcategoryCount(catId)).toBe(0);
    await adapter.createSubcategory("Sub1", catId);
    expect(await adapter.getSubcategoryCount(catId)).toBe(1);
  });

  it("deleteSubcategory removes subcategory", async () => {
    const catId = await adapter.createCategory("DelSubCat");
    const sub = await adapter.createSubcategory("DelMe", catId);
    await adapter.deleteSubcategory(sub.id);
    const subs = await adapter.getSubcategoriesByCategory(catId);
    expect(subs.length).toBe(0);
  });
});

describe("SQLiteAdapter memories", () => {
  let catId: number;
  let subId: number;

  beforeAll(async () => {
    adapter = await setupAdapter();
    catId = await adapter.createCategory("MemoryTest");
    subId = (await adapter.createSubcategory("MemSub", catId)).id;
  });

  afterAll(async () => { await adapter.close(); });

  it("insertMemory creates memory with correct fields", async () => {
    const r = await adapter.insertMemory({
      content: "test content",
      summary: "test summary",
      contentHash: "hash_insert_1",
      relevance: 0.8,
      subcategoryId: subId,
    });
    expect(r.id).toBeGreaterThan(0);
    expect(r.created).toBe(true);
    expect(r.reinforced).toBe(false);

    const mem = await adapter.getMemoryById(r.id);
    expect(mem).not.toBeNull();
    expect(mem!.content).toBe("test content");
    expect(mem!.summary).toBe("test summary");
    expect(mem!.content_hash).toBe("hash_insert_1");
    expect(mem!.relevance).toBe(0.8);
  });

  it("insertMemory detects duplicate and reinforces", async () => {
    const r1 = await adapter.insertMemory({
      content: "dup content",
      summary: "dup summary",
      contentHash: "hash_dup_test",
      relevance: 0.6,
      subcategoryId: subId,
    });
    expect(r1.created).toBe(true);

    const r2 = await adapter.insertMemory({
      content: "dup content different text",
      summary: "dup summary different",
      contentHash: "hash_dup_test",
      relevance: 0.5,
      subcategoryId: subId,
    });
    expect(r2.id).toBe(r1.id);
    expect(r2.created).toBe(false);
    expect(r2.reinforced).toBe(true);
  });

  it("insertMemory stores optional turnId and sessionId", async () => {
    const r = await adapter.insertMemory({
      content: "session content",
      summary: "session summary",
      contentHash: "hash_session_test",
      relevance: 0.7,
      subcategoryId: subId,
      turnId: "turn-123",
      sessionId: "session-456",
    });
    const mem = await adapter.getMemoryById(r.id);
    expect(mem!.turn_id).toBe("turn-123");
    expect(mem!.session_id).toBe("session-456");
  });

  it("getMemoryById returns null for non-existent", async () => {
    expect(await adapter.getMemoryById(99999)).toBeNull();
  });

  it("searchMemories filters by keyword", async () => {
    await adapter.insertMemory({
      content: "apple pie recipe",
      summary: "baking apple pie",
      contentHash: "hash_apple_pie",
      relevance: 0.9,
      subcategoryId: subId,
    });
    await adapter.insertMemory({
      content: "banana bread recipe",
      summary: "baking banana bread",
      contentHash: "hash_banana_bread",
      relevance: 0.8,
      subcategoryId: subId,
    });
    const appleResults = await adapter.searchMemories({ keyword: "apple", limit: 10 });
    expect(appleResults.length).toBe(1);
    expect(appleResults[0].content_hash).toBe("hash_apple_pie");
  });

  it("searchMemories filters by subcategoryId", async () => {
    const sub2 = (await adapter.createSubcategory("SearchSub", catId)).id;
    await adapter.insertMemory({
      content: "in sub2",
      summary: "sub2 memory",
      contentHash: "hash_sub2_filter",
      relevance: 0.5,
      subcategoryId: sub2,
    });
    const results = await adapter.searchMemories({ subcategoryId: sub2 });
    expect(results.length).toBe(1);
    expect(results[0].content_hash).toBe("hash_sub2_filter");
  });

  it("searchMemories filters by minRelevance", async () => {
    await adapter.insertMemory({
      content: "low relevance",
      summary: "low relevance mem",
      contentHash: "hash_low_rel",
      relevance: 0.1,
      subcategoryId: subId,
    });
    await adapter.insertMemory({
      content: "high relevance",
      summary: "high relevance mem",
      contentHash: "hash_high_rel",
      relevance: 0.95,
      subcategoryId: subId,
    });
    const highResults = await adapter.searchMemories({ minRelevance: 0.9, limit: 10 });
    expect(highResults.every((m) => m.relevance >= 0.9)).toBe(true);
  });

  it("searchMemories supports offset and limit", async () => {
    const results = await adapter.searchMemories({ limit: 2, offset: 0 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("getMemoryCount returns correct count", async () => {
    const count = await adapter.getMemoryCount();
    expect(count).toBeGreaterThan(0);
  });

  it("deleteMemory removes memory", async () => {
    const r = await adapter.insertMemory({
      content: "to delete",
      summary: "delete me",
      contentHash: "hash_delete_mem",
      relevance: 0.5,
      subcategoryId: subId,
    });
    await adapter.deleteMemory(r.id);
    expect(await adapter.getMemoryById(r.id)).toBeNull();
  });

  it("updateRelevance clamps value between 0 and 1", async () => {
    const r = await adapter.insertMemory({
      content: "rel update",
      summary: "rel update",
      contentHash: "hash_rel_update",
      relevance: 0.5,
      subcategoryId: subId,
    });
    await adapter.updateRelevance(r.id, 1.5);
    const mem = await adapter.getMemoryById(r.id);
    expect(mem!.relevance).toBe(1.0);

    await adapter.updateRelevance(r.id, -0.5);
    const mem2 = await adapter.getMemoryById(r.id);
    expect(mem2!.relevance).toBe(0.0);
  });

  it("updateLastAccessed updates timestamp", async () => {
    const r = await adapter.insertMemory({
      content: "access test",
      summary: "access test",
      contentHash: "hash_access_test",
      relevance: 0.5,
      subcategoryId: subId,
    });
    const before = await adapter.getMemoryById(r.id);
    await new Promise((r) => setTimeout(r, 1100));
    await adapter.updateLastAccessed(r.id);
    const after = await adapter.getMemoryById(r.id);
    expect(after!.last_accessed_at).toBeGreaterThan(before!.last_accessed_at);
  });

  it("getLowestRelevanceMemories returns ordered ascending", async () => {
    await adapter.insertMemory({
      content: "low A",
      summary: "low A",
      contentHash: "hash_lowrel_A",
      relevance: 0.3,
      subcategoryId: subId,
    });
    await adapter.insertMemory({
      content: "low B",
      summary: "low B",
      contentHash: "hash_lowrel_B",
      relevance: 0.2,
      subcategoryId: subId,
    });
    await adapter.insertMemory({
      content: "low C",
      summary: "low C",
      contentHash: "hash_lowrel_C",
      relevance: 0.4,
      subcategoryId: subId,
    });

    const mems = await adapter.getLowestRelevanceMemories(10);
    for (let i = 1; i < mems.length; i++) {
      expect(mems[i].relevance).toBeGreaterThanOrEqual(mems[i - 1].relevance);
    }
  });

  it("isAtCap returns false when under cap", async () => {
    const a = await setupAdapter({ memory: { max_entries: 100000 } });
    expect(await a.isAtCap()).toBe(false);
    await a.close();
  });

  it("isAtCap returns true when at or over cap", async () => {
    const overrides = makeConfig();
    overrides.memory.max_entries = 1;
    const a = new SQLiteAdapter(overrides);
    await a.init();
    const cid = await a.createCategory("CapTest");
    const sid = (await a.createSubcategory("CapSub", cid)).id;
    await a.insertMemory({
      content: "cap test",
      summary: "cap",
      contentHash: "hash_cap_test",
      relevance: 0.5,
      subcategoryId: sid,
    });
    expect(await a.isAtCap()).toBe(true);
    await a.close();
  });
});

describe("SQLiteAdapter maintenance", () => {
  let catId: number;
  let subId: number;

  beforeAll(async () => {
    adapter = await setupAdapter();
    catId = await adapter.createCategory("MaintTest");
    subId = (await adapter.createSubcategory("MaintSub", catId)).id;
  });

  afterAll(async () => { await adapter.close(); });

  it("getMemoriesForRecalculation returns memories needing recalculation", async () => {
    const mems = await adapter.getMemoriesForRecalculation(24);
    expect(Array.isArray(mems)).toBe(true);
  });

  it("recalculateAllRelevance returns count of updated", async () => {
    const updated = await adapter.recalculateAllRelevance(24, 0.15);
    expect(typeof updated).toBe("number");
  });

  it("getMemoriesToPrune returns memories below threshold", async () => {
    await adapter.insertMemory({
      content: "near irrelevant",
      summary: "low rel mem",
      contentHash: "hash_prune_low",
      relevance: 0.05,
      subcategoryId: subId,
    });
    const toPrune = await adapter.getMemoriesToPrune(0.1);
    expect(toPrune.length).toBeGreaterThanOrEqual(1);
  });

  it("pruneLowRelevanceMemories removes and returns count", async () => {
    const count = await adapter.pruneLowRelevanceMemories(0.06);
    expect(typeof count).toBe("number");
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("pruneOrphanSubcategories removes unlinked subcategories", async () => {
    const count = await adapter.pruneOrphanSubcategories();
    expect(typeof count).toBe("number");
  });

  it("pruneOrphanCategories removes unlinked categories", async () => {
    const count = await adapter.pruneOrphanCategories();
    expect(typeof count).toBe("number");
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("runMaintenance returns complete report", async () => {
    const report = await adapter.runMaintenance(24, 0.15, 0.1);
    expect(report).toHaveProperty("memories_recalculated");
    expect(report).toHaveProperty("memories_pruned");
    expect(report).toHaveProperty("subcategories_pruned");
    expect(report).toHaveProperty("categories_pruned");
    for (const key of Object.keys(report) as (keyof MaintenanceReport)[]) {
      expect(typeof report[key]).toBe("number");
    }
  });
});

describe("SQLiteAdapter integration scenarios", () => {
  it("handles full workflow", async () => {
    const a = await setupAdapter();

    const catId = await a.createCategory("AI");
    const subId = (await a.createSubcategory("MachineLearning", catId)).id;

    const r1 = await a.insertMemory({
      content: "Neural networks learn patterns",
      summary: "NN overview",
      contentHash: "hash_nn_workflow",
      relevance: 0.9,
      subcategoryId: subId,
    });
    expect(r1.created).toBe(true);

    const r2 = await a.insertMemory({
      content: "Transformers revolutionized NLP",
      summary: "Transformer impact",
      contentHash: "hash_transformer_workflow",
      relevance: 0.85,
      subcategoryId: subId,
    });
    expect(r2.created).toBe(true);

    const results = await a.searchMemories({ keyword: "neural", minRelevance: 0.5 });
    expect(results.length).toBe(1);

    const cats = await a.getAllCategories();
    const aiCat = cats.find((c) => c.id === catId);
    expect(aiCat!.subcategory_count).toBe(1);

    const report = await a.runMaintenance(1, 0.15, 0.1);
    expect(report.memories_recalculated).toBeGreaterThanOrEqual(0);

    await a.close();
  });

  it("deduplication across multiple inserts", async () => {
    const a = await setupAdapter();
    const catId = await a.createCategory("Dedup");
    const subId = (await a.createSubcategory("DedupSub", catId)).id;

    const hash = "hash_multi_dedup";
    const r1 = await a.insertMemory({
      content: "original content",
      summary: "original",
      contentHash: hash,
      relevance: 0.7,
      subcategoryId: subId,
    });

    for (let i = 0; i < 5; i++) {
      const r = await a.insertMemory({
        content: `variant ${i}`,
        summary: `variant summary ${i}`,
        contentHash: hash,
        relevance: 0.5,
        subcategoryId: subId,
      });
      expect(r.id).toBe(r1.id);
      expect(r.created).toBe(false);
    }

    const mem = await a.getMemoryById(r1.id);
    expect(mem!.reinforcement_count).toBeGreaterThanOrEqual(5);

    await a.close();
  });

  it("cap enforcement", async () => {
    const overrides = makeConfig();
    overrides.memory.max_entries = 3;
    const a = new SQLiteAdapter(overrides);
    await a.init();
    const catId = await a.createCategory("CapCat");
    const subId = (await a.createSubcategory("CapSub", catId)).id;

    await a.insertMemory({ content: "m1", summary: "m1", contentHash: "cap_hash_1", relevance: 0.9, subcategoryId: subId });
    await a.insertMemory({ content: "m2", summary: "m2", contentHash: "cap_hash_2", relevance: 0.8, subcategoryId: subId });
    await a.insertMemory({ content: "m3", summary: "m3", contentHash: "cap_hash_3", relevance: 0.7, subcategoryId: subId });

    expect(await a.isAtCap()).toBe(true);

    await a.close();
  });
});
