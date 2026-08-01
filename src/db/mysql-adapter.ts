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

export class MySQLAdapter implements DBAdapter {
  constructor(_config: NeuroMemoryConfig) {}

  // Lifecycle
  async init(_config: NeuroMemoryConfig): Promise<void> {
    notImplemented("MySQL");
  }
  async close(): Promise<void> {
    notImplemented("MySQL");
  }

  // Categories
  async createCategory(_name: string): Promise<number> {
    notImplemented("MySQL");
  }
  async getAllCategories(): Promise<CategoryWithCount[]> {
    notImplemented("MySQL");
  }
  async getCategoryById(_id: number): Promise<Category | null> {
    notImplemented("MySQL");
  }
  async findCategoryByName(_name: string): Promise<Category | null> {
    notImplemented("MySQL");
  }
  async findOrCreateCategory(_name: string): Promise<{ id: number; created: boolean }> {
    notImplemented("MySQL");
  }
  async getCategoryCount(): Promise<number> {
    notImplemented("MySQL");
  }
  async deleteCategory(_id: number): Promise<void> {
    notImplemented("MySQL");
  }
  async getOrphanCategories(): Promise<Category[]> {
    notImplemented("MySQL");
  }

  // Subcategories
  async createSubcategory(
    _name: string,
    _categoryId: number,
  ): Promise<{ id: number; created: boolean }> {
    notImplemented("MySQL");
  }
  async getSubcategoriesByCategory(_categoryId: number): Promise<Subcategory[]> {
    notImplemented("MySQL");
  }
  async linkSubcategoryToCategory(_subcategoryId: number, _categoryId: number): Promise<void> {
    notImplemented("MySQL");
  }
  async getSubcategoryCount(_categoryId: number): Promise<number> {
    notImplemented("MySQL");
  }
  async deleteSubcategory(_id: number): Promise<void> {
    notImplemented("MySQL");
  }

  // Memories
  async insertMemory(_input: MemoryInput): Promise<InsertResult> {
    notImplemented("MySQL");
  }
  async getMemoryById(_id: number): Promise<Memory | null> {
    notImplemented("MySQL");
  }
  async searchMemories(_query: SearchQuery): Promise<Memory[]> {
    notImplemented("MySQL");
  }
  async getMemoryCount(): Promise<number> {
    notImplemented("MySQL");
  }
  async deleteMemory(_id: number): Promise<void> {
    notImplemented("MySQL");
  }
  async updateRelevance(_id: number, _newRelevance: number): Promise<void> {
    notImplemented("MySQL");
  }
  async updateLastAccessed(_id: number): Promise<void> {
    notImplemented("MySQL");
  }
  async getLowestRelevanceMemories(_limit: number): Promise<Memory[]> {
    notImplemented("MySQL");
  }
  async isAtCap(): Promise<boolean> {
    notImplemented("MySQL");
  }

  // Ebbinghaus / Maintenance
  async getMemoriesForRecalculation(_halfLifeHours: number): Promise<any[]> {
    notImplemented("MySQL");
  }
  async recalculateAllRelevance(
    _halfLifeHours: number,
    _reinforcementBoost: number,
  ): Promise<number> {
    notImplemented("MySQL");
  }
  async getMemoriesToPrune(_minRelevance: number): Promise<any[]> {
    notImplemented("MySQL");
  }
  async pruneLowRelevanceMemories(_minRelevance: number): Promise<number> {
    notImplemented("MySQL");
  }
  async pruneOrphanSubcategories(): Promise<number> {
    notImplemented("MySQL");
  }
  async pruneOrphanCategories(): Promise<number> {
    notImplemented("MySQL");
  }
  async runMaintenance(
    _halfLifeHours: number,
    _reinforcementBoost: number,
    _minRelevance: number,
  ): Promise<MaintenanceReport> {
    notImplemented("MySQL");
  }
}
