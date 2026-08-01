import type { Database, Statement } from "bun:sqlite";
import type { NeuroMemoryConfig } from "../config";
import { initializeDatabase, closeDatabase } from "./init";
import {
  createCategory,
  getAllCategories,
  getCategoryById,
  findCategoryByName,
  findOrCreateCategory,
  createSubcategory as createSub,
  getSubcategoriesByCategory,
  linkSubcategoryToCategory as linkSub,
  deleteCategory,
  deleteSubcategory,
  getCategoryCount,
  getSubcategoryCount,
  getOrphanCategories,
} from "../categories";
import { findDuplicate, reinforceMemory } from "../hash";
import type {
  DBAdapter,
  Category,
  CategoryWithCount,
  Subcategory,
  Memory,
  MemoryInput,
  SearchQuery,
  InsertResult,
  MaintenanceReport,
} from "./adapter";

export class SQLiteAdapter implements DBAdapter {
  private db: Database | null = null;
  private config!: NeuroMemoryConfig;

  // Prepared statements
  private stmtGetMemById!: Statement;
  private stmtDelMem!: Statement;
  private stmtUpdateRelevance!: Statement;
  private stmtUpdateAccessed!: Statement;
  private stmtGetLowestRelevance!: Statement;
  private stmtCountMem!: Statement;
  private stmtSearchMem!: Statement;
  private stmtGetForRecalc!: Statement;
  private stmtRecalcAll!: Statement;
  private stmtGetToPrune!: Statement;
  private stmtPruneLowMem!: Statement;
  private stmtPruneOrphanSubs!: Statement;
  private stmtPruneOrphanCats!: Statement;

  constructor(config: NeuroMemoryConfig) {
    this.config = config;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async init(_config?: NeuroMemoryConfig): Promise<void> {
    if (_config) this.config = _config;
    const dbPath = this.config.db.sqlite_path;
    if (dbPath === ":memory:") {
      this.db = new (await import("bun:sqlite")).Database(":memory:");
      this.db.run("PRAGMA journal_mode=WAL;");
      this.db.run("PRAGMA foreign_keys=ON;");
      // Initialize schema inline for :memory: to avoid the file-check in initializeDatabase
      const { CREATE_TABLES_SQL, CREATE_INDEXES_SQL, SCHEMA_VERSION } = await import("./schema");
      for (const sql of CREATE_TABLES_SQL) {
        this.db.run(sql);
      }
      for (const sql of CREATE_INDEXES_SQL) {
        this.db.run(sql);
      }
      this.db.run("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);");
      const row = this.db.query("SELECT version FROM schema_version ORDER BY version DESC LIMIT 1").get() as { version: number } | undefined;
      if (!row) {
        this.db.run("INSERT INTO schema_version (version) VALUES (?);", [SCHEMA_VERSION]);
      }
    } else {
      this.db = initializeDatabase(dbPath);
    }
    this._prepareStatements();
  }

  async close(): Promise<void> {
    if (this.db) {
      closeDatabase(this.db);
      this.db = null;
    }
  }

  private _db(): Database {
    if (!this.db) throw new Error("Database not initialized. Call init() first.");
    return this.db;
  }

  private _prepareStatements(): void {
    const db = this._db();
    this.stmtGetMemById = db.prepare("SELECT * FROM memories WHERE id = ?");
    this.stmtDelMem = db.prepare("DELETE FROM memories WHERE id = ?");
    this.stmtUpdateRelevance = db.prepare("UPDATE memories SET relevance = ? WHERE id = ?");
    this.stmtUpdateAccessed = db.prepare("UPDATE memories SET last_accessed_at = unixepoch() WHERE id = ?");
    this.stmtGetLowestRelevance = db.prepare("SELECT * FROM memories ORDER BY relevance ASC LIMIT ?");
    this.stmtCountMem = db.prepare("SELECT COUNT(*) AS cnt FROM memories");
    this.stmtSearchMem = db.prepare(`
      SELECT * FROM memories
      WHERE (? IS NULL OR content LIKE ? OR summary LIKE ?)
        AND (? IS NULL OR subcategory_id = ?)
        AND (? IS NULL OR relevance >= ?)
      ORDER BY relevance DESC
      LIMIT ? OFFSET ?
    `);
    this.stmtGetForRecalc = db.prepare(`
      SELECT id, relevance, last_reinforced_at, reinforcement_count
      FROM memories
      WHERE (unixepoch() - last_reinforced_at) > ? * 3600
    `);
    this.stmtRecalcAll = db.prepare(`
      UPDATE memories
      SET relevance = MAX(0, MIN(1, ? * EXP(-0.693 * (unixepoch() - last_reinforced_at) / (? * 3600))))
    `);
    this.stmtGetToPrune = db.prepare("SELECT id, relevance FROM memories WHERE relevance < ?");
    this.stmtPruneLowMem = db.prepare("DELETE FROM memories WHERE relevance < ?");
    this.stmtPruneOrphanSubs = db.prepare(`
      DELETE FROM subcategories
      WHERE id NOT IN (SELECT DISTINCT subcategory_id FROM category_subcategory_links)
    `);
    this.stmtPruneOrphanCats = db.prepare(`
      DELETE FROM categories
      WHERE id NOT IN (SELECT DISTINCT category_id FROM category_subcategory_links)
    `);
  }

  // ── Categories ────────────────────────────────────────────────────────────

  async createCategory(name: string): Promise<number> {
    return createCategory(this._db(), name, this.config.memory.max_categories);
  }

  async getAllCategories(): Promise<CategoryWithCount[]> {
    return getAllCategories(this._db());
  }

  async getCategoryById(id: number): Promise<Category | null> {
    return getCategoryById(this._db(), id);
  }

  async findCategoryByName(name: string): Promise<Category | null> {
    return findCategoryByName(this._db(), name);
  }

  async findOrCreateCategory(name: string): Promise<{ id: number; created: boolean }> {
    return findOrCreateCategory(this._db(), name, this.config.memory.max_categories);
  }

  async getCategoryCount(): Promise<number> {
    return getCategoryCount(this._db());
  }

  async deleteCategory(id: number): Promise<void> {
    deleteCategory(this._db(), id);
  }

  async getOrphanCategories(): Promise<Category[]> {
    return getOrphanCategories(this._db());
  }

  // ── Subcategories ─────────────────────────────────────────────────────────

  async createSubcategory(name: string, categoryId: number): Promise<{ id: number; created: boolean }> {
    return createSub(this._db(), name, categoryId, this.config.memory.max_subcategories_per_category);
  }

  async getSubcategoriesByCategory(categoryId: number): Promise<Subcategory[]> {
    return getSubcategoriesByCategory(this._db(), categoryId);
  }

  async linkSubcategoryToCategory(subcategoryId: number, categoryId: number): Promise<void> {
    linkSub(this._db(), subcategoryId, categoryId, this.config.memory.max_subcategory_links);
  }

  async getSubcategoryCount(categoryId: number): Promise<number> {
    return getSubcategoryCount(this._db(), categoryId);
  }

  async deleteSubcategory(id: number): Promise<void> {
    deleteSubcategory(this._db(), id);
  }

  // ── Memories ──────────────────────────────────────────────────────────────

  async insertMemory(input: MemoryInput): Promise<InsertResult> {
    const db = this._db();

    // Check for duplicate via content_hash
    const existing = findDuplicate(db, input.contentHash);
    if (existing) {
      reinforceMemory(db, existing.id, this.config.ebbinghaus.reinforcement_boost);
      return { id: existing.id, created: false, reinforced: true };
    }

    const now = Math.floor(Date.now() / 1000);
    const info = db.run(
      `INSERT INTO memories (content, summary, content_hash, relevance, subcategory_id, turn_id, session_id, created_at, last_accessed_at, last_reinforced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.content,
        input.summary,
        input.contentHash,
        input.relevance,
        input.subcategoryId,
        input.turnId ?? null,
        input.sessionId ?? null,
        now,
        now,
        now,
      ],
    );

    return { id: Number(info.lastInsertRowid), created: true, reinforced: false };
  }

  async getMemoryById(id: number): Promise<Memory | null> {
    const row = this.stmtGetMemById.get(id) as Memory | undefined;
    return row ?? null;
  }

  async searchMemories(query: SearchQuery): Promise<Memory[]> {
    const keyword = query.keyword ?? null;
    const likePattern = keyword ? `%${keyword}%` : null;
    const subcatId = query.subcategoryId ?? null;
    const minRel = query.minRelevance ?? null;
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    return this.stmtSearchMem.all(
      likePattern, likePattern, likePattern,
      subcatId, subcatId,
      minRel, minRel,
      limit, offset,
    ) as Memory[];
  }

  async getMemoryCount(): Promise<number> {
    const row = this.stmtCountMem.get() as { cnt: number };
    return row.cnt;
  }

  async deleteMemory(id: number): Promise<void> {
    this.stmtDelMem.run(id);
  }

  async updateRelevance(id: number, newRelevance: number): Promise<void> {
    this.stmtUpdateRelevance.run(Math.max(0, Math.min(1, newRelevance)), id);
  }

  async updateLastAccessed(id: number): Promise<void> {
    this.stmtUpdateAccessed.run(id);
  }

  async getLowestRelevanceMemories(limit: number): Promise<Memory[]> {
    return this.stmtGetLowestRelevance.all(limit) as Memory[];
  }

  async isAtCap(): Promise<boolean> {
    const count = await this.getMemoryCount();
    return count >= this.config.memory.max_entries;
  }

  // ── Ebbinghaus / Maintenance ──────────────────────────────────────────────

  async getMemoriesForRecalculation(halfLifeHours: number): Promise<any[]> {
    return this.stmtGetForRecalc.all(halfLifeHours);
  }

  async recalculateAllRelevance(halfLifeHours: number, reinforcementBoost: number): Promise<number> {
    // Ebbinghaus formula: R = R0 * e^(-ln(2) * t / halfLife)
    // decayFactor * e^(reinforcement_count * boost) is too complex for UPDATE-only,
    // so we use a simple decay and let reinforcement boost apply at insert/reinforce time.
    const db = this._db();

    // Get all memories that need recalculation
    const memories = this.stmtGetForRecalc.all(halfLifeHours) as { id: number; relevance: number; last_reinforced_at: number; reinforcement_count: number }[];

    let count = 0;
    for (const mem of memories) {
      const now = Math.floor(Date.now() / 1000);
      const elapsedHours = (now - mem.last_reinforced_at) / 3600;
      const decay = Math.exp(-0.693 * elapsedHours / halfLifeHours);
      const boost = mem.reinforcement_count * reinforcementBoost;
      const newRelevance = Math.max(0, Math.min(1, mem.relevance * decay + boost));

      if (Math.abs(newRelevance - mem.relevance) > 0.001) {
        this.stmtUpdateRelevance.run(newRelevance, mem.id);
        count++;
      }
    }

    return count;
  }

  async getMemoriesToPrune(minRelevance: number): Promise<any[]> {
    return this.stmtGetToPrune.all(minRelevance);
  }

  async pruneLowRelevanceMemories(minRelevance: number): Promise<number> {
    const info = this.stmtPruneLowMem.run(minRelevance);
    return info.changes;
  }

  async pruneOrphanSubcategories(): Promise<number> {
    const info = this.stmtPruneOrphanSubs.run();
    return info.changes;
  }

  async pruneOrphanCategories(): Promise<number> {
    const info = this.stmtPruneOrphanCats.run();
    return info.changes;
  }

  async runMaintenance(
    halfLifeHours: number,
    reinforcementBoost: number,
    minRelevance: number,
  ): Promise<MaintenanceReport> {
    const memories_recalculated = await this.recalculateAllRelevance(halfLifeHours, reinforcementBoost);
    const memories_pruned = await this.pruneLowRelevanceMemories(minRelevance);
    const subcategories_pruned = await this.pruneOrphanSubcategories();
    const categories_pruned = await this.pruneOrphanCategories();

    return {
      memories_recalculated,
      memories_pruned,
      subcategories_pruned,
      categories_pruned,
    };
  }
}
