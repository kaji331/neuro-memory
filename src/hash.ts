/**
 * Content hashing and deduplication module.
 *
 * Provides SHA-256 based content hashing, normalization, duplicate detection,
 * and memory reinforcement for the neuro-memory skill.
 *
 * @module
 */

import type { Database } from "bun:sqlite";

// ── Types ────────────────────────────────────────────────────────────────────

export interface DuplicateRecord {
  id: number;
  content: string;
  summary: string;
  relevance: number;
}

// ── Normalization ────────────────────────────────────────────────────────────

/**
 * Normalize content for hashing:
 * 1. Trim leading/trailing whitespace
 * 2. Collapse multiple consecutive spaces into one
 * 3. Convert to lowercase
 * 4. Remove non-printable characters (keep \n for multiline)
 */
export function normalizeContent(content: string): string {
  return content
    .trim()
    .replace(/[^\x20-\x7E\n]/g, "") // keep printable ASCII + newline
    .replace(/[ ]{2,}/g, " ")       // collapse multiple spaces
    .toLowerCase();
}

// ── Hashing ──────────────────────────────────────────────────────────────────

/**
 * Compute SHA-256 hash of normalized content using Bun's crypto.subtle.
 *
 * This is a pure function — no DB connection required.
 *
 * @returns 64-character hex string
 */
export async function computeContentHash(content: string): Promise<string> {
  const normalized = normalizeContent(content);
  const encoded = new TextEncoder().encode(normalized);
  const buffer = await crypto.subtle.digest("SHA-256", encoded);
  const hashArray = Array.from(new Uint8Array(buffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Dedup & Reinforcement ────────────────────────────────────────────────────

/**
 * Check if a memory with the given hash exists in the database.
 *
 * @returns The matching record, or `null` if not found.
 */
export function findDuplicate(
  db: Database,
  hash: string,
): DuplicateRecord | null {
  const row = db
    .prepare(
      `SELECT id, content, summary, relevance FROM memories WHERE content_hash = ?`,
    )
    .get(hash) as DuplicateRecord | undefined;

  return row ?? null;
}

/**
 * Reinforce an existing memory: increment `reinforcement_count`,
 * update `last_reinforced_at`, and boost `relevance`.
 *
 * The relevance boost clamps at 1.0 so it never exceeds the valid range.
 */
export function reinforceMemory(
  db: Database,
  memoryId: number,
  boost: number,
): void {
  db.prepare(
    `UPDATE memories
     SET reinforcement_count = reinforcement_count + 1,
         last_reinforced_at = unixepoch(),
         last_accessed_at = unixepoch(),
         relevance = MIN(relevance + ?, 1.0)
     WHERE id = ?`,
  ).run(boost, memoryId);
}
