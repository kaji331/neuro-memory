# Memories Module Learnings

## Architecture
- `insertMemory` checks dedup FIRST (via `findDuplicate` from hash.ts), then reinforces rather than inserting if duplicate found
- Cap enforcement is in `insertMemory` with `maxEntries` param — throws Error when cap reached, caller must `pruneToMakeRoom` then retry
- `pruneToMakeRoom` evicts lowest-relevance-first, oldest-first (ties broken by `created_at ASC`)
- All timestamp fields use Unix epoch seconds (`Math.floor(Date.now() / 1000)`)

## Key Decisions
- Dedup returns `{ reinforced: true }` with the existing id, `{ created: true }` for new entries
- `reinforceMemory` boost is hardcoded at `0.05` for dedup scenarios
- `searchMemories` uses SQL `LIKE %keyword%` on both content and summary, sorted by relevance DESC then created_at DESC
- `updateRelevance` also touches `last_accessed_at` since relevance changes imply access
- `updateLastAccessed` only touches the timestamp — relevance and reinforcement untouched
- Deleted memories via `pruneToMakeRoom` use `WHERE id IN (...)` for batch deletion
- `pruneToMakeRoom` returns the count of deleted rows

## Patterns
- Tests follow same conventions as categories.test.ts: in-memory DB per describe block, seed helpers for subcategories
- `computeContentHash` is async (uses `crypto.subtle.digest`), so test seeding must use `async`/`await`
- Each describe block creates its own DB to avoid test pollution
- Subcategories require a parent category (FK), so test helper creates both in one call
- `getMemoryCount` test creates its own isolated DB in the `it` block (not `beforeAll`) since each sub-test needs a clean slate

## Issues
- None encountered — all 26 tests pass on first successful run after the `await`-inside-arrow fix

## Ebbinghaus Module Learnings

### Key Decisions
- `pruneLowRelevanceMemories`, `pruneOrphanSubcategories`, `pruneOrphanCategories` use count-difference (before - after) instead of `result.changes` because SQLite's `changes` includes cascade-deleted rows from foreign keys, inflating the count
- `ensureSubcategory` helper in tests auto-creates subcategories when none provided to `insertMemory`, avoiding FK constraint failures in test-only memory insertions
- Test DBs are per-test isolated (`const db = createInMemoryDatabase()` in each `it` block) to prevent stale data accumulation

### Patterns
- `runMaintenance` orders steps as: recalculate → prune memories → prune orphan subcategories → prune orphan categories (subcategory deletion may create new orphan categories)
- The Ebbinghaus formula is `R = R₀ × 0.5^(t / T)` where R₀=base relevance, t=hours since access, T=half-life
- Reinforcement boost uses diminishing returns: `boost × (1 / (1 + 0.3 × reinforcementCount))`

### Issues
- Initial `prune*` functions used `result.changes` which returned 2 when only 1 row was actually deleted (due to CASCADE counting). Fixed by using count-difference approach.
