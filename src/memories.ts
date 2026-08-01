/**
 * Memory CRUD operations with dedup integration and cap enforcement.
 *
 * Provides insert, search, delete, count, relevance update, last-accessed update,
 * lowest-relevance retrieval, cap checking, and pruning for the neuro-memory skill.
 *
 * Uses bun:sqlite Database directly. All operations assume the Database has
 * been initialized with the correct schema already applied.
 *
 * @module
 */

import type { Database } from "bun:sqlite";
import { findDuplicate, reinforceMemory } from "./hash";

// ── Types ────────────────────────────────────────────────────────────────────

export interface MemoryInput {
  content: string;
  summary: string;
  contentHash: string;
  relevance: number;
  subcategoryId: number;
  turnId?: string;
  sessionId?: string;
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

export interface SearchQuery {
  keyword?: string;
  subcategoryId?: number;
  minRelevance?: number;
  limit?: number;
  offset?: number;
}

// ── Insert / Upsert ──────────────────────────────────────────────────────────

/**
 * Insert a new memory entry.
 *
 * Deduplication: If a memory with the same `content_hash` already exists,
 * the existing memory is reinforced (via `reinforceMemory`) instead of
 * inserting a duplicate, and `{ id, created: false, reinforced: true }` is returned.
 *
 * Cap enforcement: If `maxEntries` is provided and the current count would
 * equal or exceed it after this insert, an error is thrown. The caller is
 * responsible for pruning before retrying.
 *
 * @returns `{ id, created: true, reinforced: false }` on success,
 *          `{ id, created: false, reinforced: true }` on dedup hit.
 * @throws If `maxEntries` is specified and the cap would be violated.
 */
export function insertMemory(
  db: Database,
  input: MemoryInput,
  maxEntries?: number,
): { id: number; created: boolean; reinforced: boolean } {
  // 1. Check dedup first
  const existing = findDuplicate(db, input.contentHash);
  if (existing) {
    reinforceMemory(db, existing.id, 0.05);
    return { id: existing.id, created: false, reinforced: true };
  }

  // 2. Cap check BEFORE insert
  if (maxEntries !== undefined) {
    const currentCount = getMemoryCount(db);
    if (currentCount >= maxEntries) {
      throw new Error(
        `Cannot insert memory: capacity limit of ${maxEntries} reached (current: ${currentCount}). Prune before retrying.`,
      );
    }
  }

  // 3. Insert
  const now = Math.floor(Date.now() / 1000);

  const stmt = db.prepare(
    `INSERT INTO memories
       (content, summary, content_hash, relevance, subcategory_id,
        turn_id, session_id, created_at, last_accessed_at, last_reinforced_at,
        reinforcement_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
  );

  const result = stmt.run(
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
  );

  return { id: Number(result.lastInsertRowid), created: true, reinforced: false };
}

// ── Read ─────────────────────────────────────────────────────────────────────

/**
 * Retrieve a single memory by primary key.
 *
 * @returns The Memory row, or `null` if no such id exists.
 */
export function getMemoryById(db: Database, id: number): Memory | null {
  const row = db
    .query(
      `SELECT id, content, summary, content_hash, relevance, subcategory_id,
              turn_id, session_id, created_at, last_accessed_at,
              last_reinforced_at, reinforcement_count
       FROM memories
       WHERE id = ?`,
    )
    .get(id) as Memory | undefined;

  return row ?? null;
}

// ── Search ───────────────────────────────────────────────────────────────────

/**
 * Search memories by optional keyword, subcategory, and minimum relevance.
 *
 * - `keyword`: matched against `content` and `summary` using `LIKE %keyword%`.
 * - `subcategoryId`: narrows results to one subcategory.
 * - `minRelevance`: filters out entries whose relevance is below this value.
 * - `limit`: maximum rows to return (default 10).
 * - `offset`: for pagination (default 0).
 *
 * Results are sorted by `relevance DESC, created_at DESC`.
 */
export function searchMemories(db: Database, query: SearchQuery): Memory[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (query.keyword) {
    const like = `%${query.keyword}%`;
    conditions.push("(content LIKE ? OR summary LIKE ?)");
    params.push(like, like);
  }

  if (query.subcategoryId !== undefined) {
    conditions.push("subcategory_id = ?");
    params.push(query.subcategoryId);
  }

  if (query.minRelevance !== undefined) {
    conditions.push("relevance >= ?");
    params.push(query.minRelevance);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = query.limit ?? 10;
  const offset = query.offset ?? 0;

  const sql = `
    SELECT id, content, summary, content_hash, relevance, subcategory_id,
           turn_id, session_id, created_at, last_accessed_at,
           last_reinforced_at, reinforcement_count
    FROM memories
    ${where}
    ORDER BY relevance DESC, created_at DESC
    LIMIT ? OFFSET ?
  `;

  return db
    .query(sql)
    .all(...params, limit, offset) as Memory[];
}

// ── Delete ───────────────────────────────────────────────────────────────────

/**
 * Delete a memory entry by id. No-op if the id does not exist.
 */
export function deleteMemory(db: Database, id: number): void {
  db.run("DELETE FROM memories WHERE id = ?", [id]);
}

// ── Count ────────────────────────────────────────────────────────────────────

/**
 * Return the total number of memory entries in the database.
 */
export function getMemoryCount(db: Database): number {
  const row = db
    .query("SELECT COUNT(*) AS cnt FROM memories")
    .get() as { cnt: number };
  return row.cnt;
}

// ── By Subcategory ───────────────────────────────────────────────────────────

/**
 * Return all memory entries belonging to a given subcategory, ordered by
 * relevance descending.
 */
export function getMemoriesBySubcategory(
  db: Database,
  subcategoryId: number,
): Memory[] {
  return db
    .query(
      `SELECT id, content, summary, content_hash, relevance, subcategory_id,
              turn_id, session_id, created_at, last_accessed_at,
              last_reinforced_at, reinforcement_count
       FROM memories
       WHERE subcategory_id = ?
       ORDER BY relevance DESC`,
    )
    .all(subcategoryId) as Memory[];
}

// ── Update helpers ───────────────────────────────────────────────────────────

/**
 * Set the relevance score for a memory.
 */
export function updateRelevance(
  db: Database,
  id: number,
  newRelevance: number,
): void {
  const now = Math.floor(Date.now() / 1000);
  db.run(
    "UPDATE memories SET relevance = ?, last_accessed_at = ? WHERE id = ?",
    [newRelevance, now, id],
  );
}

/**
 * Touch the `last_accessed_at` timestamp for a memory without changing
 * other fields. Useful for recording retrieval events.
 */
export function updateLastAccessed(db: Database, id: number): void {
  const now = Math.floor(Date.now() / 1000);
  db.run("UPDATE memories SET last_accessed_at = ? WHERE id = ?", [now, id]);
}

// ── Pruning helpers ──────────────────────────────────────────────────────────

/**
 * Return the N memories with the lowest relevance scores, ordered ascending.
 * Used to identify candidates for eviction when the memory cap is reached.
 */
export function getLowestRelevanceMemories(
  db: Database,
  limit: number,
): Memory[] {
  return db
    .query(
      `SELECT id, content, summary, content_hash, relevance, subcategory_id,
              turn_id, session_id, created_at, last_accessed_at,
              last_reinforced_at, reinforcement_count
       FROM memories
       ORDER BY relevance ASC, created_at ASC
       LIMIT ?`,
    )
    .all(limit) as Memory[];
}

/**
 * Check whether the total number of memory entries has reached or exceeded
 * the configured cap.
 */
export function isAtCap(db: Database, maxEntries: number): boolean {
  return getMemoryCount(db) >= maxEntries;
}

/**
 * Delete the lowest-relevance memories to bring the total count down to
 * `targetCount` (default: `maxEntries`).
 *
 * This is a simple eviction policy: lowest relevance first, then oldest first.
 *
 * @returns The number of memories deleted.
 */
export function pruneToMakeRoom(
  db: Database,
  maxEntries: number,
  targetCount?: number,
): number {
  const target = targetCount ?? maxEntries;
  const currentCount = getMemoryCount(db);

  if (currentCount <= target) {
    return 0;
  }

  const toDelete = currentCount - target;
  const candidates = getLowestRelevanceMemories(db, toDelete);

  if (candidates.length === 0) {
    return 0;
  }

  const ids = candidates.map((m) => m.id);
  const placeholders = ids.map(() => "?").join(", ");

  db.run(`DELETE FROM memories WHERE id IN (${placeholders})`, ids);
  return ids.length;
}
