import type { NeuroMemoryConfig } from "../config";

// ── Type definitions ─────────────────────────────────────────────────────────

export interface Category {
  id: number;
  name: string;
  created_at: number;
  last_used_at: number;
}

export interface CategoryWithCount extends Category {
  subcategory_count: number;
}

export interface Subcategory {
  id: number;
  name: string;
  created_at: number;
  last_used_at: number;
}

export interface Memory {
  id: number;
  content: string;
  summary: string;
  content_hash: string;
  relevance: number;
  subcategory_id: number;
  turn_id: string | null;
  session_id: string | null;
  created_at: number;
  last_accessed_at: number;
  last_reinforced_at: number;
  reinforcement_count: number;
}

export interface MemoryInput {
  content: string;
  summary: string;
  contentHash: string;
  relevance: number;
  subcategoryId: number;
  turnId?: string;
  sessionId?: string;
}

export interface SearchQuery {
  keyword?: string;
  subcategoryId?: number;
  minRelevance?: number;
  limit?: number;
  offset?: number;
}

export interface InsertResult {
  id: number;
  created: boolean;
  reinforced: boolean;
}

export interface MaintenanceReport {
  memories_recalculated: number;
  memories_pruned: number;
  subcategories_pruned: number;
  categories_pruned: number;
}

// ── Abstract interface ───────────────────────────────────────────────────────

export interface DBAdapter {
  // Lifecycle
  init(config: NeuroMemoryConfig): Promise<void>;
  close(): Promise<void>;

  // Categories
  createCategory(name: string): Promise<number>;
  getAllCategories(): Promise<CategoryWithCount[]>;
  getCategoryById(id: number): Promise<Category | null>;
  findCategoryByName(name: string): Promise<Category | null>;
  findOrCreateCategory(name: string): Promise<{ id: number; created: boolean }>;
  getCategoryCount(): Promise<number>;
  deleteCategory(id: number): Promise<void>;
  getOrphanCategories(): Promise<Category[]>;

  // Subcategories
  createSubcategory(name: string, categoryId: number): Promise<{ id: number; created: boolean }>;
  getSubcategoriesByCategory(categoryId: number): Promise<Subcategory[]>;
  linkSubcategoryToCategory(subcategoryId: number, categoryId: number): Promise<void>;
  getSubcategoryCount(categoryId: number): Promise<number>;
  deleteSubcategory(id: number): Promise<void>;

  // Memories
  insertMemory(input: MemoryInput): Promise<InsertResult>;
  getMemoryById(id: number): Promise<Memory | null>;
  searchMemories(query: SearchQuery): Promise<Memory[]>;
  getMemoryCount(): Promise<number>;
  deleteMemory(id: number): Promise<void>;
  updateRelevance(id: number, newRelevance: number): Promise<void>;
  updateLastAccessed(id: number): Promise<void>;
  getLowestRelevanceMemories(limit: number): Promise<Memory[]>;
  isAtCap(): Promise<boolean>;

  // Ebbinghaus / Maintenance
  getMemoriesForRecalculation(halfLifeHours: number): Promise<any[]>;
  recalculateAllRelevance(halfLifeHours: number, reinforcementBoost: number): Promise<number>;
  getMemoriesToPrune(minRelevance: number): Promise<any[]>;
  pruneLowRelevanceMemories(minRelevance: number): Promise<number>;
  pruneOrphanSubcategories(): Promise<number>;
  pruneOrphanCategories(): Promise<number>;
  runMaintenance(halfLifeHours: number, reinforcementBoost: number, minRelevance: number): Promise<MaintenanceReport>;
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createAdapter(config: NeuroMemoryConfig): DBAdapter {
  switch (config.db.type) {
    case "sqlite": {
      const { SQLiteAdapter } = require("./sqlite-adapter") as { SQLiteAdapter: new (config: NeuroMemoryConfig) => DBAdapter };
      return new SQLiteAdapter(config);
    }
    case "postgres": {
      const { PostgresAdapter } = require("./postgres-adapter") as { PostgresAdapter: new (config: NeuroMemoryConfig) => DBAdapter };
      return new PostgresAdapter(config);
    }
    case "duckdb": {
      const { DuckDBAdapter } = require("./duckdb-adapter") as { DuckDBAdapter: new (config: NeuroMemoryConfig) => DBAdapter };
      return new DuckDBAdapter(config);
    }
    case "mysql": {
      const { MySQLAdapter } = require("./mysql-adapter") as { MySQLAdapter: new (config: NeuroMemoryConfig) => DBAdapter };
      return new MySQLAdapter(config);
    }
    case "mariadb": {
      const { MariaDBAdapter } = require("./mariadb-adapter") as { MariaDBAdapter: new (config: NeuroMemoryConfig) => DBAdapter };
      return new MariaDBAdapter(config);
    }
    default:
      throw new Error(`Unsupported database type: ${(config.db as { type: string }).type}. Supported: sqlite, postgres, duckdb, mysql, mariadb`);
  }
}
