import type { Pool, PoolClient, QueryResult } from "pg";
import type { NeuroMemoryConfig } from "../config";
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

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MAX_CATEGORIES = 50;
const DEFAULT_MAX_SUBCATEGORIES = 100;
const DEFAULT_MAX_SUBCATEGORY_LINKS = 3;

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// ── Schema SQL (PostgreSQL) ──────────────────────────────────────────────────

const CREATE_TABLES_SQL: string[] = [
  `CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL
  );`,

  `CREATE TABLE IF NOT EXISTS subcategories (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL
  );`,

  `CREATE TABLE IF NOT EXISTS category_subcategory_links (
    id SERIAL PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    subcategory_id INTEGER NOT NULL REFERENCES subcategories(id) ON DELETE CASCADE,
    UNIQUE(category_id, subcategory_id)
  );`,

  `CREATE TABLE IF NOT EXISTS memories (
    id SERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    summary TEXT NOT NULL,
    content_hash TEXT NOT NULL UNIQUE,
    relevance REAL NOT NULL DEFAULT 0.5,
    subcategory_id INTEGER NOT NULL REFERENCES subcategories(id) ON DELETE CASCADE,
    turn_id TEXT,
    session_id TEXT,
    created_at INTEGER NOT NULL,
    last_accessed_at INTEGER NOT NULL,
    last_reinforced_at INTEGER NOT NULL,
    reinforcement_count INTEGER NOT NULL DEFAULT 0
  );`,

  `CREATE TABLE IF NOT EXISTS memory_subcategory_links (
    id SERIAL PRIMARY KEY,
    memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    subcategory_id INTEGER NOT NULL REFERENCES subcategories(id) ON DELETE CASCADE,
    UNIQUE(memory_id, subcategory_id)
  );`,

  `CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY
  );`,
];

const CREATE_INDEXES_SQL: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_memories_content_hash ON memories(content_hash);`,
  `CREATE INDEX IF NOT EXISTS idx_memories_relevance ON memories(relevance);`,
  `CREATE INDEX IF NOT EXISTS idx_memories_subcategory ON memories(subcategory_id);`,
  `CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);`,
  `CREATE INDEX IF NOT EXISTS idx_memories_accessed ON memories(last_accessed_at);`,
  `CREATE INDEX IF NOT EXISTS idx_memories_reinforced ON memories(last_reinforced_at);`,
  `CREATE INDEX IF NOT EXISTS idx_cat_sub_link_category ON category_subcategory_links(category_id);`,
  `CREATE INDEX IF NOT EXISTS idx_cat_sub_link_subcategory ON category_subcategory_links(subcategory_id);`,
  `CREATE INDEX IF NOT EXISTS idx_mem_sub_link_memory ON memory_subcategory_links(memory_id);`,
  `CREATE INDEX IF NOT EXISTS idx_mem_sub_link_subcategory ON memory_subcategory_links(subcategory_id);`,
];

const SCHEMA_VERSION = 1;

// ── Retry helper ─────────────────────────────────────────────────────────────

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastErr: Error | undefined;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }
  throw new Error(`${label} failed after ${MAX_RETRIES} retries: ${lastErr!.message}`);
}

// ── PostgresAdapter ──────────────────────────────────────────────────────────

export class PostgresAdapter implements DBAdapter {
  private pool: Pool | null = null;
  private config!: NeuroMemoryConfig;

  // pg module lazily loaded — won't fail at import time if pg is not installed
  private static _pgModule: typeof import("pg") | null = null;

  private static async _getPg(): Promise<typeof import("pg")> {
    if (!PostgresAdapter._pgModule) {
      PostgresAdapter._pgModule = await import("pg");
    }
    return PostgresAdapter._pgModule;
  }

  constructor(config: NeuroMemoryConfig) {
    this.config = config;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async init(_config?: NeuroMemoryConfig): Promise<void> {
    if (_config) this.config = _config;

    const pg = await PostgresAdapter._getPg();

    const connectionString =
      this.config.db.postgres_url ||
      process.env.DATABASE_URL ||
      "postgresql://localhost:5432/neuro_memory";

    this.pool = new pg.Pool({
      connectionString,
      min: 1,
      max: 5,
    });

    // Verify connection with retry
    await withRetry(async () => {
      const client = await this.pool!.connect();
      try {
        await client.query("SELECT 1");
      } finally {
        client.release();
      }
    }, "PostgreSQL connection");

    // Initialize schema
    await this._initSchema();
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  private _pool(): Pool {
    if (!this.pool) throw new Error("Database not initialized. Call init() first.");
    return this.pool;
  }

  // ── Query helpers ─────────────────────────────────────────────────────────

  private async _query<T = any>(text: string, params?: any[]): Promise<{ rows: T[]; rowCount: number | null }> {
    return withRetry(async () => {
      const result: QueryResult<T> = await this._pool().query(text, params);
      return { rows: result.rows, rowCount: result.rowCount };
    }, "PostgreSQL query");
  }

  private async _run(text: string, params?: any[]): Promise<{ rowCount: number }> {
    return withRetry(async () => {
      const result = await this._pool().query(text, params);
      return { rowCount: result.rowCount ?? 0 };
    }, "PostgreSQL query");
  }

  // ── Schema initialization ─────────────────────────────────────────────────

  private async _initSchema(): Promise<void> {
    for (const sql of CREATE_TABLES_SQL) {
      await this._query(sql);
    }
    for (const sql of CREATE_INDEXES_SQL) {
      await this._query(sql);
    }

    // Ensure schema_version
    await this._query(
      `CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);`,
    );
    const row = await this._queryOne<{ version: number }>(
      `SELECT version FROM schema_version ORDER BY version DESC LIMIT 1`,
    );
    if (!row) {
      await this._query(`INSERT INTO schema_version (version) VALUES ($1);`, [SCHEMA_VERSION]);
    }
  }

  private async _queryOne<T>(text: string, params?: any[]): Promise<T | null> {
    const { rows } = await this._query<T>(text, params);
    return rows[0] ?? null;
  }

  // ── Categories ────────────────────────────────────────────────────────────

  async createCategory(name: string): Promise<number> {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error("Category name must not be empty");
    }

    const cap = this.config.memory.max_categories ?? DEFAULT_MAX_CATEGORIES;
    const current = await this.getCategoryCount();
    if (current >= cap) {
      throw new Error(`Cannot create category: limit of ${cap} reached (current: ${current})`);
    }

    const now = Math.floor(Date.now() / 1000);

    // Insert with case-insensitive uniqueness check using LOWER
    const existing = await this._queryOne<{ id: number }>(
      `SELECT id FROM categories WHERE LOWER(name) = LOWER($1)`,
      [trimmed],
    );

    if (existing) {
      return existing.id;
    }

    const row = await this._queryOne<{ id: number }>(
      `INSERT INTO categories (name, created_at, last_used_at) VALUES ($1, $2, $3)
       ON CONFLICT (name) DO NOTHING
       RETURNING id`,
      [trimmed, now, now],
    );

    if (!row) {
      // Conflict happened; re-query
      const retry = await this._queryOne<{ id: number }>(
        `SELECT id FROM categories WHERE LOWER(name) = LOWER($1)`,
        [trimmed],
      );
      if (!retry) {
        throw new Error(`Failed to create or find category: "${trimmed}"`);
      }
      return retry.id;
    }

    return row.id;
  }

  async getAllCategories(): Promise<CategoryWithCount[]> {
    const { rows } = await this._query<CategoryWithCount>(`
      SELECT c.id, c.name, c.created_at, c.last_used_at,
             COUNT(csl.subcategory_id)::int AS subcategory_count
      FROM categories c
      LEFT JOIN category_subcategory_links csl ON csl.category_id = c.id
      GROUP BY c.id
      ORDER BY c.last_used_at DESC
    `);
    return rows;
  }

  async getCategoryById(id: number): Promise<Category | null> {
    return this._queryOne<Category>(
      `SELECT id, name, created_at, last_used_at FROM categories WHERE id = $1`,
      [id],
    );
  }

  async findCategoryByName(name: string): Promise<Category | null> {
    return this._queryOne<Category>(
      `SELECT id, name, created_at, last_used_at FROM categories WHERE LOWER(name) = LOWER($1)`,
      [name.trim()],
    );
  }

  async findOrCreateCategory(name: string): Promise<{ id: number; created: boolean }> {
    const existing = await this.findCategoryByName(name);
    if (existing) {
      const now = Math.floor(Date.now() / 1000);
      await this._run(`UPDATE categories SET last_used_at = $1 WHERE id = $2`, [now, existing.id]);
      return { id: existing.id, created: false };
    }

    const id = await this.createCategory(name);
    return { id, created: true };
  }

  async getCategoryCount(): Promise<number> {
    const row = await this._queryOne<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM categories`);
    return row ? parseInt(row.cnt, 10) : 0;
  }

  async deleteCategory(id: number): Promise<void> {
    await this._run(`DELETE FROM categories WHERE id = $1`, [id]);
  }

  async getOrphanCategories(): Promise<Category[]> {
    const { rows } = await this._query<Category>(`
      SELECT c.id, c.name, c.created_at, c.last_used_at
      FROM categories c
      LEFT JOIN category_subcategory_links csl ON csl.category_id = c.id
      WHERE csl.subcategory_id IS NULL
      ORDER BY c.last_used_at DESC
    `);
    return rows;
  }

  // ── Subcategories ─────────────────────────────────────────────────────────

  async createSubcategory(
    name: string,
    categoryId: number,
  ): Promise<{ id: number; created: boolean }> {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error("Subcategory name must not be empty");
    }

    const cat = await this.getCategoryById(categoryId);
    if (!cat) {
      throw new Error(`Category with id ${categoryId} does not exist`);
    }

    const cap = this.config.memory.max_subcategories_per_category ?? DEFAULT_MAX_SUBCATEGORIES;
    const current = await this.getSubcategoryCount(categoryId);
    if (current >= cap) {
      throw new Error(
        `Cannot create subcategory: limit of ${cap} per category reached for category "${cat.name}" (current: ${current})`,
      );
    }

    const now = Math.floor(Date.now() / 1000);

    let subcategoryId: number;
    let created = false;

    // Check if subcategory name already exists
    const existingSub = await this._queryOne<{ id: number }>(
      `SELECT id FROM subcategories WHERE name = $1`,
      [trimmed],
    );

    if (existingSub) {
      subcategoryId = existingSub.id;
      await this._run(`UPDATE subcategories SET last_used_at = $1 WHERE id = $2`, [now, subcategoryId]);
    } else {
      const row = await this._queryOne<{ id: number }>(
        `INSERT INTO subcategories (name, created_at, last_used_at) VALUES ($1, $2, $3)
         ON CONFLICT (name) DO NOTHING
         RETURNING id`,
        [trimmed, now, now],
      );

      if (!row) {
        const retry = await this._queryOne<{ id: number }>(
          `SELECT id FROM subcategories WHERE name = $1`,
          [trimmed],
        );
        subcategoryId = retry!.id;
      } else {
        subcategoryId = row.id;
        created = true;
      }
    }

    // Link subcategory to category (if not already linked)
    const existingLink = await this._queryOne<{ id: number }>(
      `SELECT id FROM category_subcategory_links WHERE category_id = $1 AND subcategory_id = $2`,
      [categoryId, subcategoryId],
    );

    if (!existingLink) {
      await this._run(
        `INSERT INTO category_subcategory_links (category_id, subcategory_id) VALUES ($1, $2)
         ON CONFLICT (category_id, subcategory_id) DO NOTHING`,
        [categoryId, subcategoryId],
      );
    }

    // Touch the category's last_used_at
    await this._run(`UPDATE categories SET last_used_at = $1 WHERE id = $2`, [now, categoryId]);

    return { id: subcategoryId, created };
  }

  async getSubcategoriesByCategory(categoryId: number): Promise<Subcategory[]> {
    const { rows } = await this._query<Subcategory>(`
      SELECT s.id, s.name, s.created_at, s.last_used_at
      FROM subcategories s
      INNER JOIN category_subcategory_links csl ON csl.subcategory_id = s.id
      WHERE csl.category_id = $1
      ORDER BY s.last_used_at DESC
    `, [categoryId]);
    return rows;
  }

  async linkSubcategoryToCategory(
    subcategoryId: number,
    categoryId: number,
  ): Promise<void> {
    // Verify both exist
    const sub = await this._queryOne<{ id: number }>(
      `SELECT id FROM subcategories WHERE id = $1`,
      [subcategoryId],
    );
    if (!sub) {
      throw new Error(`Subcategory with id ${subcategoryId} does not exist`);
    }

    const cat = await this.getCategoryById(categoryId);
    if (!cat) {
      throw new Error(`Category with id ${categoryId} does not exist`);
    }

    // Check if already linked
    const existing = await this._queryOne<{ id: number }>(
      `SELECT id FROM category_subcategory_links WHERE category_id = $1 AND subcategory_id = $2`,
      [categoryId, subcategoryId],
    );
    if (existing) return;

    // Check link cap
    const cap = this.config.memory.max_subcategory_links ?? DEFAULT_MAX_SUBCATEGORY_LINKS;
    const countRow = await this._queryOne<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM category_subcategory_links WHERE subcategory_id = $1`,
      [subcategoryId],
    );
    const linkCount = countRow ? parseInt(countRow.cnt, 10) : 0;
    if (linkCount >= cap) {
      throw new Error(
        `Cannot link subcategory: limit of ${cap} links per subcategory reached (current: ${linkCount})`,
      );
    }

    await this._run(
      `INSERT INTO category_subcategory_links (category_id, subcategory_id) VALUES ($1, $2)
       ON CONFLICT (category_id, subcategory_id) DO NOTHING`,
      [categoryId, subcategoryId],
    );

    const now = Math.floor(Date.now() / 1000);
    await this._run(`UPDATE subcategories SET last_used_at = $1 WHERE id = $2`, [now, subcategoryId]);
    await this._run(`UPDATE categories SET last_used_at = $1 WHERE id = $2`, [now, categoryId]);
  }

  async getSubcategoryCount(categoryId: number): Promise<number> {
    const row = await this._queryOne<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM category_subcategory_links WHERE category_id = $1`,
      [categoryId],
    );
    return row ? parseInt(row.cnt, 10) : 0;
  }

  async deleteSubcategory(id: number): Promise<void> {
    await this._run(`DELETE FROM subcategories WHERE id = $1`, [id]);
  }

  // ── Memories ──────────────────────────────────────────────────────────────

  async insertMemory(input: MemoryInput): Promise<InsertResult> {
    // Check for duplicate via content_hash
    const existing = await this._queryOne<{ id: number; content: string; summary: string; relevance: number }>(
      `SELECT id, content, summary, relevance FROM memories WHERE content_hash = $1`,
      [input.contentHash],
    );

    if (existing) {
      // Reinforce
      const boost = this.config.ebbinghaus.reinforcement_boost;
      await this._run(
        `UPDATE memories
         SET reinforcement_count = reinforcement_count + 1,
             last_reinforced_at = EXTRACT(EPOCH FROM NOW())::int,
             last_accessed_at = EXTRACT(EPOCH FROM NOW())::int,
             relevance = LEAST(relevance + $1, 1.0)
         WHERE id = $2`,
        [boost, existing.id],
      );
      return { id: existing.id, created: false, reinforced: true };
    }

    const now = Math.floor(Date.now() / 1000);
    const row = await this._queryOne<{ id: number }>(
      `INSERT INTO memories (content, summary, content_hash, relevance, subcategory_id, turn_id, session_id, created_at, last_accessed_at, last_reinforced_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
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

    return { id: row!.id, created: true, reinforced: false };
  }

  async getMemoryById(id: number): Promise<Memory | null> {
    return this._queryOne<Memory>(`SELECT * FROM memories WHERE id = $1`, [id]);
  }

  async searchMemories(query: SearchQuery): Promise<Memory[]> {
    const keyword = query.keyword ?? null;
    const subcatId = query.subcategoryId ?? null;
    const minRel = query.minRelevance ?? null;
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    const { rows } = await this._query<Memory>(
      `SELECT * FROM memories
       WHERE ($1::text IS NULL OR content ILIKE $2 OR summary ILIKE $3)
         AND ($4::int IS NULL OR subcategory_id = $5)
         AND ($6::real IS NULL OR relevance >= $7)
       ORDER BY relevance DESC
       LIMIT $8 OFFSET $9`,
      [
        keyword,
        keyword ? `%${keyword}%` : null,
        keyword ? `%${keyword}%` : null,
        subcatId,
        subcatId,
        minRel,
        minRel,
        limit,
        offset,
      ],
    );
    return rows;
  }

  async getMemoryCount(): Promise<number> {
    const row = await this._queryOne<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM memories`);
    return row ? parseInt(row.cnt, 10) : 0;
  }

  async deleteMemory(id: number): Promise<void> {
    await this._run(`DELETE FROM memories WHERE id = $1`, [id]);
  }

  async updateRelevance(id: number, newRelevance: number): Promise<void> {
    const clamped = Math.max(0, Math.min(1, newRelevance));
    await this._run(`UPDATE memories SET relevance = $1 WHERE id = $2`, [clamped, id]);
  }

  async updateLastAccessed(id: number): Promise<void> {
    await this._run(
      `UPDATE memories SET last_accessed_at = EXTRACT(EPOCH FROM NOW())::int WHERE id = $1`,
      [id],
    );
  }

  async getLowestRelevanceMemories(limit: number): Promise<Memory[]> {
    const { rows } = await this._query<Memory>(
      `SELECT * FROM memories ORDER BY relevance ASC LIMIT $1`,
      [limit],
    );
    return rows;
  }

  async isAtCap(): Promise<boolean> {
    const count = await this.getMemoryCount();
    return count >= this.config.memory.max_entries;
  }

  // ── Ebbinghaus / Maintenance ──────────────────────────────────────────────

  async getMemoriesForRecalculation(halfLifeHours: number): Promise<any[]> {
    const { rows } = await this._query(
      `SELECT id, relevance, last_reinforced_at, reinforcement_count
       FROM memories
       WHERE (EXTRACT(EPOCH FROM NOW())::int - last_reinforced_at) > $1 * 3600`,
      [halfLifeHours],
    );
    return rows;
  }

  async recalculateAllRelevance(
    halfLifeHours: number,
    reinforcementBoost: number,
  ): Promise<number> {
    const memories = await this.getMemoriesForRecalculation(halfLifeHours) as {
      id: number;
      relevance: number;
      last_reinforced_at: number;
      reinforcement_count: number;
    }[];

    let count = 0;
    const now = Math.floor(Date.now() / 1000);

    for (const mem of memories) {
      const elapsedHours = (now - mem.last_reinforced_at) / 3600;
      const decay = Math.exp(-0.693 * elapsedHours / halfLifeHours);
      const boost = mem.reinforcement_count * reinforcementBoost;
      const newRelevance = Math.max(0, Math.min(1, mem.relevance * decay + boost));

      if (Math.abs(newRelevance - mem.relevance) > 0.001) {
        await this._run(`UPDATE memories SET relevance = $1 WHERE id = $2`, [newRelevance, mem.id]);
        count++;
      }
    }

    return count;
  }

  async getMemoriesToPrune(minRelevance: number): Promise<any[]> {
    const { rows } = await this._query(
      `SELECT id, relevance FROM memories WHERE relevance < $1`,
      [minRelevance],
    );
    return rows;
  }

  async pruneLowRelevanceMemories(minRelevance: number): Promise<number> {
    const { rowCount } = await this._run(`DELETE FROM memories WHERE relevance < $1`, [minRelevance]);
    return rowCount;
  }

  async pruneOrphanSubcategories(): Promise<number> {
    const { rowCount } = await this._run(`
      DELETE FROM subcategories
      WHERE id NOT IN (SELECT DISTINCT subcategory_id FROM category_subcategory_links)
    `);
    return rowCount;
  }

  async pruneOrphanCategories(): Promise<number> {
    const { rowCount } = await this._run(`
      DELETE FROM categories
      WHERE id NOT IN (SELECT DISTINCT category_id FROM category_subcategory_links)
    `);
    return rowCount;
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
