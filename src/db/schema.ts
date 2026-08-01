export const SCHEMA_VERSION = 1;

export const CREATE_TABLES_SQL: string[] = [
  `CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL DEFAULT (unixepoch())
  );`,

  `CREATE TABLE IF NOT EXISTS subcategories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL
  );`,

  `CREATE TABLE IF NOT EXISTS category_subcategory_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    subcategory_id INTEGER NOT NULL REFERENCES subcategories(id) ON DELETE CASCADE,
    UNIQUE(category_id, subcategory_id)
  );`,

  `CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    subcategory_id INTEGER NOT NULL REFERENCES subcategories(id) ON DELETE CASCADE,
    UNIQUE(memory_id, subcategory_id)
  );`,

  `CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY
  );`,
];

export const CREATE_INDEXES_SQL: string[] = [
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
