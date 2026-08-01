/**
 * Ebbinghaus forgetting curve implementation, pruning scheduler, and orphan cleanup.
 *
 * The Ebbinghaus forgetting curve models how memory relevance decays over time
 * since the last access/reinforcement. This module provides:
 *
 * 1. Pure math functions for relevance calculation and reinforcement boost
 * 2. DB functions for batch relevance recalculation, pruning, and orphan cleanup
 * 3. A `runMaintenance` routine that orchestrates all maintenance steps
 *
 * @module
 */

import type { Database } from "bun:sqlite";

// ── Types ────────────────────────────────────────────────────────────────────

export interface MaintenanceReport {
  memories_recalculated: number;
  memories_pruned: number;
  subcategories_pruned: number;
  categories_pruned: number;
}

export interface MemoryRecalcRow {
  id: number;
  relevance: number;
  last_accessed_at: number;
  reinforcement_count: number;
}

export interface PruneCandidate {
  id: number;
  content: string;
  summary: string;
  relevance: number;
}

// ── Pure Math Functions ──────────────────────────────────────────────────────

/**
 * Calculates the decayed relevance using the Ebbinghaus forgetting curve.
 *
 * R = R₀ × 0.5^(t / T)
 *
 * Where:
 *   R₀ = base (initial) relevance score
 *   t  = hours since last access/reinforcement
 *   T  = half-life in hours
 *
 * At t = T (one half-life), relevance drops to R₀/2.
 * At t = 2T, it's R₀/4, etc.
 *
 * For very large t, relevance approaches but never reaches 0;
 * we clamp small values to 0 for practical purposes.
 *
 * @param baseRelevance Initial relevance score (0.0-1.0)
 * @param halfLifeHours Half-life in hours (must be > 0)
 * @param hoursSinceLastAccess Hours since the memory was last accessed/reinforced
 * @returns Decayed relevance score in range [0.0, baseRelevance]
 */
export function calculateRelevance(
  baseRelevance: number,
  halfLifeHours: number,
  hoursSinceLastAccess: number,
): number {
  if (halfLifeHours <= 0) {
    return 0;
  }

  if (hoursSinceLastAccess <= 0) {
    return baseRelevance;
  }

  // R = R₀ × 0.5^(t / T)
  const exponent = hoursSinceLastAccess / halfLifeHours;
  const decay = Math.pow(0.5, exponent);
  const result = baseRelevance * decay;

  // Clamp: never go below 0
  if (result < 1e-12) {
    return 0;
  }

  return result;
}

/**
 * Calculates the reinforcement boost with diminishing returns.
 *
 * Each subsequent reinforcement gives slightly less boost.
 * Formula: boost × (1 / (1 + 0.3 × (reinforcementCount - 1)))
 *
 * The first reinforcement (count=0→1) gets the full boost.
 * Each additional reinforcement adds progressively less.
 *
 * @param baseBoost The configured reinforcement_boost value (e.g., 0.15)
 * @param reinforcementCount How many times this memory has been reinforced
 * @returns The actual boost to apply
 */
export function getReinforcementBoost(
  baseBoost: number,
  reinforcementCount: number,
): number {
  if (reinforcementCount <= 0) {
    return baseBoost;
  }

  const diminishingFactor = 1 + 0.3 * reinforcementCount;
  return baseBoost * (1 / diminishingFactor);
}

/**
 * Calculates hours since a Unix timestamp (in seconds).
 *
 * @param timestamp Unix timestamp in seconds
 * @returns Hours elapsed since the timestamp, or 0 if timestamp is in the future
 */
export function hoursSince(timestamp: number): number {
  const now = Math.floor(Date.now() / 1000);
  const deltaSeconds = now - timestamp;

  if (deltaSeconds <= 0) {
    return 0;
  }

  return deltaSeconds / 3600;
}

// ── DB Functions ─────────────────────────────────────────────────────────────

/**
 * Gets all memories that need their relevance recalculated.
 *
 * A memory needs recalculation when:
 *   hours_since_last_access > halfLifeHours * 0.5
 *
 * We use 0.5 × halfLifeHours as a threshold so we catch memories whose
 * relevance has already dropped noticeably but aren't yet near zero.
 *
 * @param db Database connection
 * @param halfLifeHours Half-life in hours
 * @returns Array of memory rows needing recalculation
 */
export function getMemoriesForRecalculation(
  db: Database,
  halfLifeHours: number,
): MemoryRecalcRow[] {
  const thresholdSeconds = halfLifeHours * 0.5 * 3600;
  const now = Math.floor(Date.now() / 1000);

  return db
    .prepare(
      `SELECT id, relevance, last_accessed_at, reinforcement_count
       FROM memories
       WHERE ? - last_accessed_at >= ?`,
    )
    .all(now, thresholdSeconds) as MemoryRecalcRow[];
}

/**
 * Recalculates relevance for all memories using the Ebbinghaus forgetting curve.
 *
 * For each memory, computes:
 *   newRelevance = calculateRelevance(currentRelevance, halfLifeHours, hoursSinceLastAccess)
 *   boostedRelevance = MIN(newRelevance + getReinforcementBoost(reinforcementBoost, reinforcementCount), 1.0)
 *
 * Only memories that have aged past halfLifeHours * 0.5 are updated.
 *
 * @param db Database connection
 * @param halfLifeHours Half-life in hours
 * @param reinforcementBoost Base boost applied for each reinforcement
 * @returns Number of memories updated
 */
export function recalculateAllRelevance(
  db: Database,
  halfLifeHours: number,
  reinforcementBoost: number,
): number {
  const candidates = getMemoriesForRecalculation(db, halfLifeHours);
  let updated = 0;

  for (const mem of candidates) {
    const hoursSinceAccess = hoursSince(mem.last_accessed_at);

    // Apply decay
    let newRelevance = calculateRelevance(
      mem.relevance,
      halfLifeHours,
      hoursSinceAccess,
    );

    // Apply reinforcement boost (diminishing returns)
    const boost = getReinforcementBoost(reinforcementBoost, mem.reinforcement_count);
    newRelevance = Math.min(newRelevance + boost, 1.0);

    db.prepare("UPDATE memories SET relevance = ? WHERE id = ?").run(
      newRelevance,
      mem.id,
    );
    updated++;
  }

  return updated;
}

/**
 * Finds memories eligible for pruning (relevance below minRelevance).
 *
 * @param db Database connection
 * @param minRelevance Minimum relevance threshold (0.0-1.0)
 * @returns Prune candidates sorted by relevance ASC (lowest first)
 */
export function getMemoriesToPrune(
  db: Database,
  minRelevance: number,
): PruneCandidate[] {
  return db
    .prepare(
      `SELECT id, content, summary, relevance
       FROM memories
       WHERE relevance < ?
       ORDER BY relevance ASC`,
    )
    .all(minRelevance) as PruneCandidate[];
}

/**
 * Deletes all memories with relevance below the minRelevance threshold.
 *
 * Deletions cascade to memory_subcategory_links via foreign key.
 *
 * @param db Database connection
 * @param minRelevance Minimum relevance threshold (0.0-1.0)
 * @returns Number of memories deleted
 */
export function pruneLowRelevanceMemories(
  db: Database,
  minRelevance: number,
): number {
  const before = (
    db.prepare("SELECT COUNT(*) AS cnt FROM memories").get() as { cnt: number }
  ).cnt;

  db.prepare("DELETE FROM memories WHERE relevance < ?").run(minRelevance);

  const after = (
    db.prepare("SELECT COUNT(*) AS cnt FROM memories").get() as { cnt: number }
  ).cnt;

  return before - after;
}

/**
 * Deletes categories that have NO linked subcategories (orphans).
 *
 * A category is orphaned when it has no entries in category_subcategory_links.
 * Deletion cascades via foreign keys.
 *
 * @param db Database connection
 * @returns Number of categories deleted
 */
export function pruneOrphanCategories(db: Database): number {
  const before = (
    db.prepare("SELECT COUNT(*) AS cnt FROM categories").get() as { cnt: number }
  ).cnt;

  db.prepare(
    `DELETE FROM categories
     WHERE id IN (
       SELECT c.id
       FROM categories c
       LEFT JOIN category_subcategory_links csl ON csl.category_id = c.id
       WHERE csl.id IS NULL
     )`,
  ).run();

  const after = (
    db.prepare("SELECT COUNT(*) AS cnt FROM categories").get() as { cnt: number }
  ).cnt;

  return before - after;
}

/**
 * Deletes subcategories that have NO linked memories (orphans).
 *
 * A subcategory is orphaned when it has no entries in memory_subcategory_links.
 * Deletion cascades to category_subcategory_links via foreign key.
 *
 * @param db Database connection
 * @returns Number of subcategories deleted
 */
export function pruneOrphanSubcategories(db: Database): number {
  const before = (
    db.prepare("SELECT COUNT(*) AS cnt FROM subcategories").get() as { cnt: number }
  ).cnt;

  db.prepare(
    `DELETE FROM subcategories
     WHERE id IN (
       SELECT s.id
       FROM subcategories s
       LEFT JOIN memory_subcategory_links msl ON msl.subcategory_id = s.id
       WHERE msl.id IS NULL
     )`,
  ).run();

  const after = (
    db.prepare("SELECT COUNT(*) AS cnt FROM subcategories").get() as { cnt: number }
  ).cnt;

  return before - after;
}

/**
 * Runs the full maintenance routine:
 *
 * 1. Recalculates all relevance scores using the forgetting curve
 * 2. Prunes low-relevance memories (below minRelevance)
 * 3. Prunes orphan subcategories (no linked memories)
 * 4. Prunes orphan categories (no linked subcategories)
 *
 * Steps 3 and 4 are run in this order because deleting subcategories
 * may create new orphan categories, which step 4 then cleans up.
 *
 * @param db Database connection
 * @param halfLifeHours Half-life in hours for relevance decay
 * @param reinforcementBoost Base boost for each reinforcement
 * @param minRelevance Minimum relevance threshold for pruning
 * @returns MaintenanceReport with counts of what was done
 */
export function runMaintenance(
  db: Database,
  halfLifeHours: number,
  reinforcementBoost: number,
  minRelevance: number,
): MaintenanceReport {
  const memories_recalculated = recalculateAllRelevance(
    db,
    halfLifeHours,
    reinforcementBoost,
  );

  const memories_pruned = pruneLowRelevanceMemories(db, minRelevance);

  const subcategories_pruned = pruneOrphanSubcategories(db);

  const categories_pruned = pruneOrphanCategories(db);

  return {
    memories_recalculated,
    memories_pruned,
    subcategories_pruned,
    categories_pruned,
  };
}
