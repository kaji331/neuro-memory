import type { NeuroMemoryConfig } from "../config";
import type {
  DBAdapter,
  Category,
  Subcategory,
  Memory,
  MemoryInput,
  SearchQuery,
  InsertResult,
  MaintenanceReport,
  CategoryWithCount,
} from "./adapter";

function notImplemented(label: string): never {
  throw new Error(`${label} adapter not implemented yet. Contributions welcome!`);
}

export class DuckDBAdapter implements DBAdapter {
  constructor(_config: NeuroMemoryConfig) {}

  // Lifecycle
  async init(_config: NeuroMemoryConfig): Promise<void> {
    notImplemented("DuckDB");
  }
  async close(): Promise<void> {
    notImplemented("DuckDB");
  }

  // Categories
  async createCategory(_name: string): Promise<number> {
    notImplemented("DuckDB");
  }
  async getAllCategories(): Promise<CategoryWithCount[]> {
    notImplemented("DuckDB");
  }
  async getCategoryById(_id: number): Promise<Category | null> {
    notImplemented("DuckDB");
  }
  async findCategoryByName(_name: string): Promise<Category | null> {
    notImplemented("DuckDB");
  }
  async findOrCreateCategory(_name: string): Promise<{ id: number; created: boolean }> {
    notImplemented("DuckDB");
  }
  async getCategoryCount(): Promise<number> {
    notImplemented("DuckDB");
  }
  async deleteCategory(_id: number): Promise<void> {
    notImplemented("DuckDB");
  }
  async getOrphanCategories(): Promise<Category[]> {
    notImplemented("DuckDB");
  }

  // Subcategories
  async createSubcategory(
    _name: string,
    _categoryId: number,
  ): Promise<{ id: number; created: boolean }> {
    notImplemented("DuckDB");
  }
  async getSubcategoriesByCategory(_categoryId: number): Promise<Subcategory[]> {
    notImplemented("DuckDB");
  }
  async linkSubcategoryToCategory(_subcategoryId: number, _categoryId: number): Promise<void> {
    notImplemented("DuckDB");
  }
  async getSubcategoryCount(_categoryId: number): Promise<number> {
    notImplemented("DuckDB");
  }
  async deleteSubcategory(_id: number): Promise<void> {
    notImplemented("DuckDB");
  }

  // Memories
  async insertMemory(_input: MemoryInput): Promise<InsertResult> {
    notImplemented("DuckDB");
  }
  async getMemoryById(_id: number): Promise<Memory | null> {
    notImplemented("DuckDB");
  }
  async searchMemories(_query: SearchQuery): Promise<Memory[]> {
    notImplemented("DuckDB");
  }
  async getMemoryCount(): Promise<number> {
    notImplemented("DuckDB");
  }
  async deleteMemory(_id: number): Promise<void> {
    notImplemented("DuckDB");
  }
  async updateRelevance(_id: number, _newRelevance: number): Promise<void> {
    notImplemented("DuckDB");
  }
  async updateLastAccessed(_id: number): Promise<void> {
    notImplemented("DuckDB");
  }
  async getLowestRelevanceMemories(_limit: number): Promise<Memory[]> {
    notImplemented("DuckDB");
  }
  async isAtCap(): Promise<boolean> {
    notImplemented("DuckDB");
  }

  // Ebbinghaus / Maintenance
  async getMemoriesForRecalculation(_halfLifeHours: number): Promise<any[]> {
    notImplemented("DuckDB");
  }
  async recalculateAllRelevance(
    _halfLifeHours: number,
    _reinforcementBoost: number,
  ): Promise<number> {
    notImplemented("DuckDB");
  }
  async getMemoriesToPrune(_minRelevance: number): Promise<any[]> {
    notImplemented("DuckDB");
  }
  async pruneLowRelevanceMemories(_minRelevance: number): Promise<number> {
    notImplemented("DuckDB");
  }
  async pruneOrphanSubcategories(): Promise<number> {
    notImplemented("DuckDB");
  }
  async pruneOrphanCategories(): Promise<number> {
    notImplemented("DuckDB");
  }
  async runMaintenance(
    _halfLifeHours: number,
    _reinforcementBoost: number,
    _minRelevance: number,
  ): Promise<MaintenanceReport> {
    notImplemented("DuckDB");
  }
}
