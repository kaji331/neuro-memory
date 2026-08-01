import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createInMemoryDatabase, closeDatabase } from "../src/db/init";
import type { Database } from "bun:sqlite";
import {
  createCategory,
  getAllCategories,
  getCategoryById,
  findCategoryByName,
  findOrCreateCategory,
  createSubcategory,
  getSubcategoriesByCategory,
  linkSubcategoryToCategory,
  deleteCategory,
  deleteSubcategory,
  getCategoryCount,
  getSubcategoryCount,
  getOrphanCategories,
} from "../src/categories";

function seedCategory(db: Database, name: string): number {
  const now = Math.floor(Date.now() / 1000);
  db.run("INSERT INTO categories (name, created_at, last_used_at) VALUES (?, ?, ?)", [
    name,
    now,
    now,
  ]);
  const row = db.query("SELECT id FROM categories WHERE name = ? COLLATE NOCASE").get(name) as {
    id: number;
  };
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

describe("createCategory", () => {
  let db: Database;

  beforeAll(() => {
    db = createInMemoryDatabase();
  });

  afterAll(() => {
    closeDatabase(db);
  });

  it("creates a category and returns its id", () => {
    const id = createCategory(db, "Programming");
    expect(id).toBeGreaterThan(0);

    const cat = getCategoryById(db, id);
    expect(cat).not.toBeNull();
    expect(cat!.name).toBe("Programming");
    expect(cat!.created_at).toBeGreaterThan(0);
    expect(cat!.last_used_at).toBeGreaterThan(0);
  });

  it("returns the same id for a case-insensitive duplicate", () => {
    const id1 = createCategory(db, "Math");
    const id2 = createCategory(db, "MATH");
    expect(id2).toBe(id1);
  });

  it("returns the same id for exact duplicate", () => {
    const id1 = createCategory(db, "Science");
    const id2 = createCategory(db, "Science");
    expect(id2).toBe(id1);
  });

  it("trims whitespace from the name", () => {
    const id = createCategory(db, "  History  ");
    const cat = getCategoryById(db, id);
    expect(cat!.name).toBe("History");
  });

  it("throws on empty name", () => {
    expect(() => createCategory(db, "")).toThrow("Category name must not be empty");
    expect(() => createCategory(db, "   ")).toThrow("Category name must not be empty");
  });
});

describe("getAllCategories", () => {
  let db: Database;

  beforeAll(() => {
    db = createInMemoryDatabase();
  });

  afterAll(() => {
    closeDatabase(db);
  });

  it("returns empty array with no categories", () => {
    const cats = getAllCategories(db);
    expect(cats).toEqual([]);
  });

  it("returns categories with subcategory_count = 0 when no links", () => {
    createCategory(db, "Art");
    createCategory(db, "Music");

    const cats = getAllCategories(db);
    expect(cats.length).toBe(2);
    expect(cats[0].subcategory_count).toBe(0);
    expect(cats[1].subcategory_count).toBe(0);
  });

  it("returns correct subcategory_count when links exist", () => {
    const catId = createCategory(db, "Literature");
    createSubcategory(db, "Poetry", catId);
    createSubcategory(db, "Fiction", catId);

    const cats = getAllCategories(db);
    const lit = cats.find((c) => c.name === "Literature");
    expect(lit).toBeDefined();
    expect(lit!.subcategory_count).toBe(2);
  });
});

describe("getCategoryById", () => {
  let db: Database;

  beforeAll(() => {
    db = createInMemoryDatabase();
  });

  afterAll(() => {
    closeDatabase(db);
  });

  it("returns null for non-existent id", () => {
    expect(getCategoryById(db, 999)).toBeNull();
  });

  it("returns the category for an existing id", () => {
    const id = createCategory(db, "Physics");
    const cat = getCategoryById(db, id);
    expect(cat).not.toBeNull();
    expect(cat!.id).toBe(id);
    expect(cat!.name).toBe("Physics");
  });
});

describe("findCategoryByName", () => {
  let db: Database;

  beforeAll(() => {
    db = createInMemoryDatabase();
  });

  afterAll(() => {
    closeDatabase(db);
  });

  it("returns null when no match", () => {
    expect(findCategoryByName(db, "NoSuchCategory")).toBeNull();
  });

  it("finds by exact name", () => {
    const id = createCategory(db, "Chemistry");
    const cat = findCategoryByName(db, "Chemistry");
    expect(cat).not.toBeNull();
    expect(cat!.id).toBe(id);
  });

  it("finds case-insensitively", () => {
    createCategory(db, "Biology");
    const cat = findCategoryByName(db, "BIOLOGY");
    expect(cat).not.toBeNull();
    expect(cat!.name).toBe("Biology");
  });
});

describe("findOrCreateCategory", () => {
  let db: Database;

  beforeAll(() => {
    db = createInMemoryDatabase();
  });

  afterAll(() => {
    closeDatabase(db);
  });

  it("creates when category does not exist", () => {
    const result = findOrCreateCategory(db, "NewCategory");
    expect(result.created).toBe(true);
    expect(result.id).toBeGreaterThan(0);

    const cat = getCategoryById(db, result.id);
    expect(cat!.name).toBe("NewCategory");
  });

  it("returns existing with created=false", () => {
    createCategory(db, "ExistingOne");
    const result = findOrCreateCategory(db, "ExistingOne");
    expect(result.created).toBe(false);
    expect(result.id).toBeGreaterThan(0);
  });

  it("returns existing when case differs", () => {
    createCategory(db, "CaseTest");
    const result = findOrCreateCategory(db, "casetest");
    expect(result.created).toBe(false);
  });
});

describe("createSubcategory", () => {
  let db: Database;
  let catId: number;

  beforeAll(() => {
    db = createInMemoryDatabase();
    catId = createCategory(db, "Tech");
  });

  afterAll(() => {
    closeDatabase(db);
  });

  it("creates a subcategory linked to a category", () => {
    const result = createSubcategory(db, "JavaScript", catId);
    expect(result.id).toBeGreaterThan(0);
    expect(result.created).toBe(true);

    const subs = getSubcategoriesByCategory(db, catId);
    expect(subs.length).toBe(1);
    expect(subs[0].name).toBe("JavaScript");
  });

  it("returns created=false when subcategory name already exists and is linked", () => {
    const first = createSubcategory(db, "TypeScript", catId);
    const second = createSubcategory(db, "TypeScript", catId);
    expect(second.id).toBe(first.id);
    expect(second.created).toBe(false);
  });

  it("throws when category does not exist", () => {
    expect(() => createSubcategory(db, "Orphan", 999)).toThrow("does not exist");
  });

  it("throws on empty subcategory name", () => {
    expect(() => createSubcategory(db, "", catId)).toThrow("must not be empty");
  });
});

describe("getSubcategoriesByCategory", () => {
  let db: Database;
  let catId: number;

  beforeAll(() => {
    db = createInMemoryDatabase();
    catId = createCategory(db, "Sports");
  });

  afterAll(() => {
    closeDatabase(db);
  });

  it("returns empty array for category with no subcategories", () => {
    const subs = getSubcategoriesByCategory(db, catId);
    expect(subs).toEqual([]);
  });

  it("returns subcategories for category", () => {
    createSubcategory(db, "Soccer", catId);
    createSubcategory(db, "Basketball", catId);

    const subs = getSubcategoriesByCategory(db, catId);
    expect(subs.length).toBe(2);
    const names = subs.map((s) => s.name).sort();
    expect(names).toEqual(["Basketball", "Soccer"]);
  });
});

describe("linkSubcategoryToCategory", () => {
  let db: Database;

  beforeAll(() => {
    db = createInMemoryDatabase();
  });

  afterAll(() => {
    closeDatabase(db);
  });

  it("links a subcategory to a second category", () => {
    const cat1 = createCategory(db, "CatA");
    const cat2 = createCategory(db, "CatB");
    const sub = createSubcategory(db, "SharedTopic", cat1);

    linkSubcategoryToCategory(db, sub.id, cat2);

    const subsA = getSubcategoriesByCategory(db, cat1);
    const subsB = getSubcategoriesByCategory(db, cat2);
    expect(subsA.length).toBe(1);
    expect(subsB.length).toBe(1);
    expect(subsB[0].name).toBe("SharedTopic");
  });

  it("is a no-op when already linked", () => {
    const cat1 = createCategory(db, "CatC");
    const sub = createSubcategory(db, "AlreadyLinked", cat1);

    expect(() => linkSubcategoryToCategory(db, sub.id, cat1)).not.toThrow();
  });

  it("throws when subcategory does not exist", () => {
    const cat = createCategory(db, "CatD");
    expect(() => linkSubcategoryToCategory(db, 999, cat)).toThrow("does not exist");
  });

  it("throws when category does not exist", () => {
    const cat = createCategory(db, "CatE");
    const sub = createSubcategory(db, "ValidSub", cat);
    expect(() => linkSubcategoryToCategory(db, sub.id, 999)).toThrow("does not exist");
  });

  it("throws when exceeding max subcategory links", () => {
    const subId = seedSubcategory(db, "MaxLinkSub");

    for (let i = 0; i < 3; i++) {
      const cid = createCategory(db, `LinkCat${i}`);
      linkSubcategoryToCategory(db, subId, cid, 3);
    }

    const extraCat = createCategory(db, "LinkCatExtra");
    expect(() => linkSubcategoryToCategory(db, subId, extraCat, 3)).toThrow(
      "limit of 3 links",
    );
  });
});

describe("category cap enforcement", () => {
  it("throws when creating more categories than the cap", () => {
    const db = createInMemoryDatabase();

    for (let i = 0; i < 50; i++) {
      createCategory(db, `CapCat${i}`, 50);
    }

    expect(getCategoryCount(db)).toBe(50);

    expect(() => createCategory(db, "CapCat51", 50)).toThrow(
      "limit of 50 reached",
    );

    closeDatabase(db);
  });
});

describe("subcategory cap enforcement", () => {
  it("throws when creating more subcategories than the cap for a category", () => {
    const db = createInMemoryDatabase();
    const catId = createCategory(db, "TestCat");

    for (let i = 0; i < 100; i++) {
      createSubcategory(db, `CapSub${i}`, catId, 100);
    }

    expect(getSubcategoryCount(db, catId)).toBe(100);

    expect(() => createSubcategory(db, "CapSub101", catId, 100)).toThrow(
      "limit of 100 per category",
    );

    closeDatabase(db);
  });
});

describe("deleteCategory", () => {
  let db: Database;

  beforeAll(() => {
    db = createInMemoryDatabase();
  });

  afterAll(() => {
    closeDatabase(db);
  });

  it("deletes a category and its category_subcategory_links", () => {
    const catId = createCategory(db, "ToDelete");
    createSubcategory(db, "SubToKeep", catId);

    const subsBefore = getSubcategoriesByCategory(db, catId);
    expect(subsBefore.length).toBe(1);

    deleteCategory(db, catId);

    expect(getCategoryById(db, catId)).toBeNull();

    const links = db
      .query("SELECT id FROM category_subcategory_links WHERE category_id = ?")
      .all(catId);
    expect(links.length).toBe(0);

    const sub = db
      .query("SELECT id, name FROM subcategories WHERE name = ?")
      .get("SubToKeep") as { id: number; name: string } | undefined;
    expect(sub).toBeDefined();
  });

  it("is a no-op when deleting non-existent category", () => {
    expect(() => deleteCategory(db, 9999)).not.toThrow();
  });
});

describe("deleteSubcategory", () => {
  let db: Database;

  beforeAll(() => {
    db = createInMemoryDatabase();
  });

  afterAll(() => {
    closeDatabase(db);
  });

  it("deletes a subcategory and its links", () => {
    const catId = createCategory(db, "CatForSubDelete");
    const subId = seedSubcategory(db, "SubToDelete");

    db.run("INSERT INTO category_subcategory_links (category_id, subcategory_id) VALUES (?, ?)", [
      catId,
      subId,
    ]);

    deleteSubcategory(db, subId);

    const subRow = db
      .query("SELECT id FROM subcategories WHERE id = ?")
      .get(subId) as { id: number } | undefined;
    expect(subRow).toBeNull();

    const links = db
      .query("SELECT id FROM category_subcategory_links WHERE subcategory_id = ?")
      .all(subId);
    expect(links.length).toBe(0);
  });
});

describe("getOrphanCategories", () => {
  let db: Database;

  beforeAll(() => {
    db = createInMemoryDatabase();
  });

  afterAll(() => {
    closeDatabase(db);
  });

  it("returns categories with no linked subcategories", () => {
    const catWithSub = createCategory(db, "WithSub");
    const catOrphan = createCategory(db, "NoSub");

    createSubcategory(db, "HasSub", catWithSub);

    const orphans = getOrphanCategories(db);
    const orphanNames = orphans.map((c) => c.name);
    expect(orphanNames).toContain("NoSub");
    expect(orphanNames).not.toContain("WithSub");
  });

  it("returns all categories when none have subcategories", () => {
    const db2 = createInMemoryDatabase();
    createCategory(db2, "A");
    createCategory(db2, "B");

    const orphans = getOrphanCategories(db2);
    expect(orphans.length).toBe(2);

    closeDatabase(db2);
  });

  it("returns empty array when all categories have subcategories", () => {
    const db2 = createInMemoryDatabase();
    const c1 = createCategory(db2, "C1");
    const c2 = createCategory(db2, "C2");
    createSubcategory(db2, "S1", c1);
    createSubcategory(db2, "S2", c2);

    const orphans = getOrphanCategories(db2);
    expect(orphans.length).toBe(0);

    closeDatabase(db2);
  });
});

describe("getCategoryCount / getSubcategoryCount", () => {
  let db: Database;

  beforeAll(() => {
    db = createInMemoryDatabase();
  });

  afterAll(() => {
    closeDatabase(db);
  });

  it("getCategoryCount starts at 0 and increases", () => {
    expect(getCategoryCount(db)).toBe(0);
    createCategory(db, "Count1");
    expect(getCategoryCount(db)).toBe(1);
    createCategory(db, "Count2");
    expect(getCategoryCount(db)).toBe(2);
  });

  it("getSubcategoryCount reflects links for a category", () => {
    const catId = createCategory(db, "CountCat");
    expect(getSubcategoryCount(db, catId)).toBe(0);

    createSubcategory(db, "SubA", catId);
    expect(getSubcategoryCount(db, catId)).toBe(1);

    createSubcategory(db, "SubB", catId);
    expect(getSubcategoryCount(db, catId)).toBe(2);
  });
});

describe("full integration scenario", () => {
  it("handles a realistic workflow: create → link → query → delete", () => {
    const db = createInMemoryDatabase();

    const catAI = createCategory(db, "AI");
    const catML = createCategory(db, "Machine Learning");

    const subDL = createSubcategory(db, "Deep Learning", catAI);
    const subNLP = createSubcategory(db, "NLP", catAI);
    const subRL = createSubcategory(db, "Reinforcement Learning", catML);

    linkSubcategoryToCategory(db, subDL.id, catML);

    expect(getCategoryCount(db)).toBe(2);

    const aiSubs = getSubcategoriesByCategory(db, catAI);
    expect(aiSubs.length).toBe(2);

    const mlSubs = getSubcategoriesByCategory(db, catML);
    expect(mlSubs.length).toBe(2);

    const found = findCategoryByName(db, "ai");
    expect(found).not.toBeNull();
    expect(found!.id).toBe(catAI);

    const all = getAllCategories(db);
    expect(all.length).toBe(2);
    const aiRow = all.find((c) => c.id === catAI);
    const mlRow = all.find((c) => c.id === catML);
    expect(aiRow!.subcategory_count).toBe(2);
    expect(mlRow!.subcategory_count).toBe(2);

    deleteCategory(db, catML);
    expect(getCategoryById(db, catML)).toBeNull();

    const aiSubsAfter = getSubcategoriesByCategory(db, catAI);
    expect(aiSubsAfter.length).toBe(2);

    const dlAfter = db
      .query("SELECT id FROM subcategories WHERE name = ?")
      .get("Deep Learning") as { id: number } | undefined;
    expect(dlAfter).toBeDefined();

    closeDatabase(db);
  });
});
