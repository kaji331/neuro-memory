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

export class MariaDBAdapter implements DBAdapter {
  constructor(_config: NeuroMemoryConfig) {}

  // Lifecycle
  async init(_config: NeuroMemoryConfig): Promise<void> {
    notImplemented("MariaDB");
  }
  async close(): Promise<void> {
    notImplemented("MariaDB");
  }

  // Categories
  async createCategory(_name: string): Promise<number> {
    notImplemented("MariaDB");
  }
  async getAllCategories(): Promise<CategoryWithCount[]> {
    notImplemented("MariaDB");
  }
  async getCategoryById(_id: number): Promise<Category | null> {
    notImplemented("MariaDB");
  }
  async findCategoryByName(_name: string): Promise<Category | null> {
    notImplemented("MariaDB");
  }
  async findOrCreateCategory(_name: string): Promise<{ id: number; created: boolean }> {
    notImplemented("MariaDB");
  }
  async getCategoryCount(): Promise<number> {
    notImplemented("MariaDB");
  }
  async deleteCategory(_id: number): Promise<void> {
    notImplemented("MariaDB");
  }
  async getOrphanCategories(): Promise<Category[]> {
    notImplemented("MariaDB");
  }

  // Subcategories
  async createSubcategory(
    _name: string,
    _categoryId: number,
  ): Promise<{ id: number; created: boolean }> {
    notImplemented("MariaDB");
  }
  async getSubcategoriesByCategory(_categoryId: number): Promise<Subcategory[]> {
    notImplemented("MariaDB");
  }
  async linkSubcategoryToCategory(_subcategoryId: number, _categoryId: number): Promise<void> {
    notImplemented("MariaDB");
  }
  async getSubcategoryCount(_categoryId: number): Promise<number> {
    notImplemented("MariaDB");
  }
  async deleteSubcategory(_id: number): Promise<void> {
    notImplemented("MariaDB");
  }

  // Memories
  async insertMemory(_input: MemoryInput): Promise<InsertResult> {
    notImplemented("MariaDB");
  }
  async getMemoryById(_id: number): Promise<Memory | null> {
    notImplemented("MariaDB");
  }
  async searchMemories(_query: SearchQuery): Promise<Memory[]> {
    notImplemented("MariaDB");
  }
  async getMemoryCount(): Promise<number> {
    notImplemented("MariaDB");
  }
  async deleteMemory(_id: number): Promise<void> {
    notImplemented("MariaDB");
  }
  async updateRelevance(_id: number, _newRelevance: number): Promise<void> {
    notImplemented("MariaDB");
  }
  async updateLastAccessed(_id: number): Promise<void> {
    notImplemented("MariaDB");
  }
  async getLowestRelevanceMemories(_limit: number): Promise<Memory[]> {
    notImplemented("MariaDB");
  }
  async isAtCap(): Promise<boolean> {
    notImplemented("MariaDB");
  }

  // Ebbinghaus / Maintenance
  async getMemoriesForRecalculation(_halfLifeHours: number): Promise<any[]> {
    notImplemented("MariaDB");
  }
  async recalculateAllRelevance(
    _halfLifeHours: number,
    _reinforcementBoost: number,
  ): Promise<number> {
    notImplemented("MariaDB");
  }
  async getMemoriesToPrune(_minRelevance: number): Promise<any[]> {
    notImplemented("MariaDB");
  }
  async pruneLowRelevanceMemories(_minRelevance: number): Promise<number> {
    notImplemented("MariaDB");
  }
  async pruneOrphanSubcategories(): Promise<number> {
    notImplemented("MariaDB");
  }
  async pruneOrphanCategories(): Promise<number> {
    notImplemented("MariaDB");
  }
  async runMaintenance(
    _halfLifeHours: number,
    _reinforcementBoost: number,
    _minRelevance: number,
  ): Promise<MaintenanceReport> {
    notImplemented("MariaDB");
  }
}
