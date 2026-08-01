import type { Database } from "bun:sqlite";

// ── Type definitions ─────────────────────────────────────────────────────────

export interface Category {
  id: number;
  name: string;
  created_at: number;
  last_used_at: number;
}

export interface Subcategory {
  id: number;
  name: string;
  created_at: number;
  last_used_at: number;
}

export interface CategoryWithCount extends Category {
  subcategory_count: number;
}

// ── Default cap values (mirrored from config.ts defaults) ─────────────────────

const DEFAULT_MAX_CATEGORIES = 50;
const DEFAULT_MAX_SUBCATEGORIES = 100;
const DEFAULT_MAX_SUBCATEGORY_LINKS = 3;

// ── Category CRUD ────────────────────────────────────────────────────────────

/**
 * Creates a category if not exists (UNIQUE NOCASE), returns the id.
 * Name is trimmed for comparison; the original casing is stored.
 * Throws if the category cap is exceeded.
 */
export function createCategory(db: Database, name: string, maxCategories?: number): number {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Category name must not be empty");
  }

  const cap = maxCategories ?? DEFAULT_MAX_CATEGORIES;
  const current = getCategoryCount(db);
  if (current >= cap) {
    throw new Error(`Cannot create category: limit of ${cap} reached (current: ${current})`);
  }

  const now = Math.floor(Date.now() / 1000);

  db.run(
    `INSERT OR IGNORE INTO categories (name, created_at, last_used_at) VALUES (?, ?, ?)`,
    [trimmed, now, now],
  );

  // INSERT OR IGNORE may not insert if duplicate; fetch the id either way
  const row = db
    .query("SELECT id FROM categories WHERE name = ? COLLATE NOCASE")
    .get(trimmed) as { id: number } | null;

  if (!row) {
    throw new Error(`Failed to create or find category: "${trimmed}"`);
  }

  return row.id;
}

/**
 * Returns all categories with the count of linked subcategories,
 * ordered by last_used_at descending.
 */
export function getAllCategories(db: Database): CategoryWithCount[] {
  return db
    .query(`
      SELECT c.id, c.name, c.created_at, c.last_used_at,
             COUNT(csl.subcategory_id) AS subcategory_count
      FROM categories c
      LEFT JOIN category_subcategory_links csl ON csl.category_id = c.id
      GROUP BY c.id
      ORDER BY c.last_used_at DESC
    `)
    .all() as CategoryWithCount[];
}

/**
 * Returns a single category by id, or null if not found.
 */
export function getCategoryById(db: Database, id: number): Category | null {
  const row = db
    .query("SELECT id, name, created_at, last_used_at FROM categories WHERE id = ?")
    .get(id) as Category | undefined;
  return row ?? null;
}

/**
 * Finds a category by name (case-insensitive via COLLATE NOCASE).
 * Returns null if no match.
 */
export function findCategoryByName(db: Database, name: string): Category | null {
  const row = db
    .query("SELECT id, name, created_at, last_used_at FROM categories WHERE name = ? COLLATE NOCASE")
    .get(name.trim()) as Category | undefined;
  return row ?? null;
}

/**
 * Find or create: returns the existing category id (created=false) or
 * creates a new one (created=true) within the cap.
 */
export function findOrCreateCategory(
  db: Database,
  name: string,
  maxCategories?: number,
): { id: number; created: boolean } {
  const existing = findCategoryByName(db, name);
  if (existing) {
    // Touch last_used_at
    const now = Math.floor(Date.now() / 1000);
    db.run("UPDATE categories SET last_used_at = ? WHERE id = ?", [now, existing.id]);
    return { id: existing.id, created: false };
  }

  const id = createCategory(db, name, maxCategories);
  return { id, created: true };
}

// ── Subcategory CRUD ─────────────────────────────────────────────────────────

/**
 * Creates a subcategory and links it to the given category.
 * Returns {id, created: boolean} — created=false if the subcategory name
 * already exists and is already linked to this category.
 * Throws if the subcategory cap for that category is exceeded.
 */
export function createSubcategory(
  db: Database,
  name: string,
  categoryId: number,
  maxSubcategories?: number,
): { id: number; created: boolean } {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Subcategory name must not be empty");
  }

  // Verify category exists
  const cat = getCategoryById(db, categoryId);
  if (!cat) {
    throw new Error(`Category with id ${categoryId} does not exist`);
  }

  const cap = maxSubcategories ?? DEFAULT_MAX_SUBCATEGORIES;
  const current = getSubcategoryCount(db, categoryId);
  if (current >= cap) {
    throw new Error(
      `Cannot create subcategory: limit of ${cap} per category reached for category "${cat.name}" (current: ${current})`,
    );
  }

  const now = Math.floor(Date.now() / 1000);

  // Check if subcategory name already exists
  const existingSub = db
    .query("SELECT id FROM subcategories WHERE name = ?")
    .get(trimmed) as { id: number } | undefined;

  let subcategoryId: number;
  let created = false;

  if (existingSub) {
    subcategoryId = existingSub.id;
    // Touch last_used_at
    db.run("UPDATE subcategories SET last_used_at = ? WHERE id = ?", [now, subcategoryId]);
  } else {
    db.run(
      "INSERT INTO subcategories (name, created_at, last_used_at) VALUES (?, ?, ?)",
      [trimmed, now, now],
    );
    const row = db
      .query("SELECT id FROM subcategories WHERE name = ?")
      .get(trimmed) as { id: number };
    subcategoryId = row.id;
    created = true;
  }

  // Link subcategory to category (if not already linked)
  const existingLink = db
    .query("SELECT id FROM category_subcategory_links WHERE category_id = ? AND subcategory_id = ?")
    .get(categoryId, subcategoryId) as { id: number } | undefined;

  if (!existingLink) {
    db.run(
      "INSERT OR IGNORE INTO category_subcategory_links (category_id, subcategory_id) VALUES (?, ?)",
      [categoryId, subcategoryId],
    );
  }

  // Also touch the category's last_used_at
  db.run("UPDATE categories SET last_used_at = ? WHERE id = ?", [now, categoryId]);

  return { id: subcategoryId, created };
}

/**
 * Returns subcategories linked to a category via the category_subcategory_links table.
 */
export function getSubcategoriesByCategory(db: Database, categoryId: number): Subcategory[] {
  return db
    .query(`
      SELECT s.id, s.name, s.created_at, s.last_used_at
      FROM subcategories s
      INNER JOIN category_subcategory_links csl ON csl.subcategory_id = s.id
      WHERE csl.category_id = ?
      ORDER BY s.last_used_at DESC
    `)
    .all(categoryId) as Subcategory[];
}

/**
 * Links an existing subcategory to an additional category.
 * Throws if the link cap is exceeded.
 */
export function linkSubcategoryToCategory(
  db: Database,
  subcategoryId: number,
  categoryId: number,
  maxLinks?: number,
): void {
  // Verify both exist
  const sub = db
    .query("SELECT id FROM subcategories WHERE id = ?")
    .get(subcategoryId) as { id: number } | undefined;
  if (!sub) {
    throw new Error(`Subcategory with id ${subcategoryId} does not exist`);
  }

  const cat = getCategoryById(db, categoryId);
  if (!cat) {
    throw new Error(`Category with id ${categoryId} does not exist`);
  }

  // Check if already linked
  const existing = db
    .query("SELECT id FROM category_subcategory_links WHERE category_id = ? AND subcategory_id = ?")
    .get(categoryId, subcategoryId) as { id: number } | undefined;
  if (existing) {
    // Already linked — no-op
    return;
  }

  // Check link cap (number of distinct categories this subcategory is linked to)
  const cap = maxLinks ?? DEFAULT_MAX_SUBCATEGORY_LINKS;
  const linkCount = (
    db
      .query("SELECT COUNT(*) AS cnt FROM category_subcategory_links WHERE subcategory_id = ?")
      .get(subcategoryId) as { cnt: number }
  ).cnt;

  if (linkCount >= cap) {
    throw new Error(
      `Cannot link subcategory: limit of ${cap} links per subcategory reached (current: ${linkCount})`,
    );
  }

  db.run(
    "INSERT INTO category_subcategory_links (category_id, subcategory_id) VALUES (?, ?)",
    [categoryId, subcategoryId],
  );

  // Touch timestamps
  const now = Math.floor(Date.now() / 1000);
  db.run("UPDATE subcategories SET last_used_at = ? WHERE id = ?", [now, subcategoryId]);
  db.run("UPDATE categories SET last_used_at = ? WHERE id = ?", [now, categoryId]);
}

// ── Delete operations ────────────────────────────────────────────────────────

/**
 * Deletes a category and all its category_subcategory_links (via FK CASCADE).
 * Does NOT delete the subcategories themselves.
 */
export function deleteCategory(db: Database, id: number): void {
  db.run("DELETE FROM categories WHERE id = ?", [id]);
}

/**
 * Deletes a subcategory and all its links (via FK CASCADE).
 */
export function deleteSubcategory(db: Database, id: number): void {
  db.run("DELETE FROM subcategories WHERE id = ?", [id]);
}

// ── Count helpers for cap enforcement ───────────────────────────────────────

/**
 * Returns the total number of categories.
 */
export function getCategoryCount(db: Database): number {
  const row = db.query("SELECT COUNT(*) AS cnt FROM categories").get() as { cnt: number };
  return row.cnt;
}

/**
 * Returns the number of subcategories linked to a given category.
 */
export function getSubcategoryCount(db: Database, categoryId: number): number {
  const row = db
    .query("SELECT COUNT(*) AS cnt FROM category_subcategory_links WHERE category_id = ?")
    .get(categoryId) as { cnt: number };
  return row.cnt;
}

/**
 * Returns categories that have no linked subcategories.
 */
export function getOrphanCategories(db: Database): Category[] {
  return db
    .query(`
      SELECT c.id, c.name, c.created_at, c.last_used_at
      FROM categories c
      LEFT JOIN category_subcategory_links csl ON csl.category_id = c.id
      WHERE csl.subcategory_id IS NULL
      ORDER BY c.last_used_at DESC
    `)
    .all() as Category[];
}
