# Neuro-Memory: A Memory Skill System for opencode Agents

## TL;DR

> **Quick Summary**: Build a RAG-based memory skill for opencode agents that automatically records conversations into a 3-tier hierarchical database (SQLite default, configurable to other DBs) and retrieves relevant memories before each response — all driven by LLM subagents without vector embeddings.
>
> **Deliverables**:
> - Bun/TypeScript core library (`src/`) with DB operations, Ebbinghaus decay, config validation
> - CLI tool (`neuro-memory`) for query/insert/delete/maintenance
> - SKILL.md for opencode auto-integration
> - YAML config file with all tunable parameters
> - Test suite (TDD) covering all non-LLM logic
>
> **Estimated Effort**: Large (15-20 tasks across 4 waves)
> **Parallel Execution**: YES — 4 waves, max 6 concurrent tasks
> **Critical Path**: Task 1 → 2 → 5 → 10 → 14 → F1-F4 → User Okay

---

## Context

### Original Request
Build a widely compatible memory skill system (an integrated RAG system) for opencode and similar agents. The system records agent conversation content into a database after summarization/classification, and retrieves relevant memories before each response to provide context.

### Interview Summary

**Key Discussions**:
- **Name**: neuro-memory (user approved)
- **Tech Stack**: Bun/TypeScript (not C/C++, not Python)
- **Database**: SQLite default (bun:sqlite), configurable to PostgreSQL/DuckDB/MySQL/MariaDB
- **Table Structure**: 3 tables — categories, subcategories, memories (user confirmed)
- **Classification**: All 3-tier hierarchy dynamically created by LLM subagent (no pre-defined categories)
- **Relevance Judgment**: LLM-only, no vector embeddings (user confirmed)
- **Memory Recording**: Async — spawn background subagent via `task(run_in_background=true)`, don't wait
- **Memory Retrieval**: Before each agent response, query DB via LLM relevance check, inject top N into system prompt
- **Forgetting Curve**: Ebbinghaus (user confirmed, not Maslow)
- **Entry Cap**: 5000 hard cap (user confirmed)
- **Config Format**: YAML
- **Integration**: SKILL.md instruction-based (no hooks). Agent reads SKILL.md every turn.
- **Subagent Isolation**: Memory system NOT applied to subagents (subagents don't inherit skills)
- **Summarization Model**: Configurable (can use cheaper model via task() subagent_type)
- **Test Strategy**: TDD (user confirmed)
- **Memory Sharing**: Local SQLite default, network DB optional via config

**Metis-Identified Guardrails** (all accepted by user):
- Category caps: 50 max top-level, 100 max subcategories per category
- Retrieval timeout: 3s, fall back to no memory injection
- SQLite WAL mode enabled
- SKILL.md in pseudocode style (Step 1/2/3), not descriptive prose
- Hard cap enforced synchronously before insertion
- Content hashing (SHA-256) for deduplication
- Schema versioning via migration table

### Metis Review

**Identified Gaps** (addressed):
- **P0: task(run_in_background=true) viability** → Confirmed by user, known to work non-blocking
- **P0: SKILL.md → task() instruction** → Confirmed, SKILL.md can instruct agent to call task()
- **P0: subagent file access** → Assumed working (same filesystem), WAL mode mitigates concurrent access
- **Category explosion** → Addressed with 50/100 caps and deduplication prompts
- **LLM output validation** → JSON schema validation layer before DB insert
- **Concurrent SQLite access** → WAL mode + queue/retry in insert logic
- **Schema migration** → schema_version table in init

---

## Work Objectives

### Core Objective
Build and install a fully functional neuro-memory skill at `~/.agents/skills/neuro-memory/` that:
1. Automatically records every human-involved conversation turn as structured memories
2. Automatically retrieves and injects relevant memories before each agent response
3. Maintains a 3-tier dynamic classification hierarchy via LLM subagents
4. Self-manages via Ebbinghaus forgetting curve and hard 5000-entry cap

### Concrete Deliverables
- `~/.agents/skills/neuro-memory/SKILL.md` — Agent integration instructions
- `~/.agents/skills/neuro-memory/neuro-memory.yaml` — Config file
- `~/.agents/skills/neuro-memory/src/` — Bun/TypeScript source (core lib + CLI)
- `~/.agents/skills/neuro-memory/scripts/` — Helper scripts
- `~/.agents/skills/neuro-memory/package.json` — Bun project
- `~/.agents/skills/neuro-memory/tsconfig.json` — TypeScript config
- Default DB at: `~/.agents/skills/neuro-memory/data/memory.db` (auto-created)
- Evidence dir: `~/.agents/skills/neuro-memory/.sisyphus/evidence/`

### Must Have
- [ ] Memory recording: each human conversation turn → summarized → classified → stored
- [ ] Memory retrieval: before each response → query → top 3 relevant → injected into system prompt
- [ ] 3-tier dynamic classification (categories / subcategories / memories) via LLM
- [ ] Ebbinghaus forgetting curve-based decay and pruning
- [ ] 5000-entry hard cap with automatic low-relevance cleanup
- [ ] YAML config with ALL tunable parameters
- [ ] Subagent isolation: memory NOT applied to subagents
- [ ] SHA-256 content deduplication (reinforcement)
- [ ] SQLite WAL mode enabled by default
- [ ] Schema versioning and migration support
- [ ] Support for PostgreSQL/DuckDB/MySQL/MariaDB via config

### Must NOT Have (Guardrails)
- No vector embeddings — LLM-only relevance judgment
- No Web UI / Dashboard — CLI-only inspection
- No cross-session memory sharing (Phase 1)
- No complex eviction algorithms beyond Ebbinghaus + cap
- No extension to subagents (by design, skills don't auto-inherit)
- No external runtime dependencies beyond Bun + npm packages
- No Python dependencies

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: NO (new project)
- **Automated tests**: TDD
- **Framework**: Bun's built-in test runner (`bun test`)
- **TDD flow**: Each implementation task follows: write test → see it fail (RED) → write minimal code to pass (GREEN) → refactor if needed

### What's Testable vs LLM-Dependent
The TDD approach focuses on non-LLM logic:
- Database CRUD operations (create/read/update/delete memories)
- Ebbinghaus decay function (pure math: `relevance * e^(-lambda * delta_t)`)
- Config parsing and validation (YAML schema checks)
- Entry cap enforcement (insert fails when >= 5000)
- Content hashing and deduplication (SHA-256)
- Category/subcategory CRUD with cascade delete
- Ebbinghaus pruning scheduler

LLM-dependent parts (classification, summarization, relevance scoring) are tested via integration tests with mock LLM responses.

### QA Policy
Every task MUST include agent-executed QA scenarios. Evidence saved to:
`.sisyphus/evidence/neuro-memory/task-{N}-{scenario-slug}.{ext}`

- **CLI/Module**: Bash — run CLI commands, check stdout/stderr/exit code
- **DB**: Bash + bun — query SQLite tables, assert row counts and values
- **Config**: Bash — validate with malformed config, confirm error handling
- **TDD tests**: `bun test` — must pass

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — foundation + scaffolding):
├── Task 1: Project scaffolding + config [quick]
├── Task 2: Database schema + migration system [quick]
├── Task 3: Config parser + validation [quick]
├── Task 4: Content hashing + dedup module [quick]
└── Task 5: YAML default config file [quick]

Wave 2 (After Wave 1 — core business logic, MAX PARALLEL):
├── Task 6: Category/subcategory CRUD operations [unspecified-high]
├── Task 7: Memory entry CRUD with cap enforcement [unspecified-high]
├── Task 8: Ebbinghaus decay function + pruning scheduler [deep]
├── Task 9: DB adapter interface (SQLite impl) [unspecified-high]
├── Task 10: DB adapter: PostgreSQL impl [unspecified-high]
├── Task 11: DB adapter: DuckDB/MySQL/MariaDB stubs [unspecified-high]
└── Task 12: LLM classification prompt + output validator [deep]

Wave 3 (After Wave 2 — CLI + integration layer):
├── Task 13: CLI tool — query command [quick]
├── Task 14: CLI tool — insert/reinforce command [unspecified-high]
├── Task 15: CLI tool — prune/maintenance command [quick]
├── Task 16: CLI tool — config validation command [quick]
├── Task 17: SKILL.md — retrieval instruction [unspecified-high]
└── Task 18: SKILL.md — recording instruction [unspecified-high]

Wave FINAL (After ALL implementation tasks — 4 parallel reviews):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real end-to-end QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
```

### Dependency Matrix
- **2**: 1 - 6, 7, 8, 9
- **3**: 1 - 6, 7, 8
- **4**: 1 - 7
- **5**: 1 - 13-15
- **6**: 2, 3, 4 - 12
- **7**: 2, 3, 4 - 13, 14
- **8**: 3 - 14, 15
- **9**: 2 - 10, 11
- **10**: 9 - 13-15
- **11**: 9 - (no downstream)
- **12**: 6 - 14, 17, 18
- **13**: 7, 10 - 17, 18
- **14**: 7, 8, 10, 12 - 17, 18
- **15**: 8, 10 - (final)
- **16**: 3, 5 - (final)
- **17**: 12, 13 - (final)
- **18**: 12, 13, 14 - (final)

### Agent Dispatch Summary
- **Wave 1**: 5 tasks → all `quick`
- **Wave 2**: 7 tasks → `unspecified-high`(5) + `deep`(2)
- **Wave 3**: 6 tasks → `quick`(3) + `unspecified-high`(2) + `deep`(1)
- **Final**: 4 tasks → `oracle`(1) + `unspecified-high`(2) + `deep`(1)

---

## TODOs

- [x] 1. **Scaffold Project Structure + Config**

  **What to do**:
  - Create directory: `~/.agents/skills/neuro-memory/` with subdirs: `src/`, `scripts/`, `data/`, `.sisyphus/evidence/`
  - Create `package.json` with `bun init` (name: `neuro-memory`, type: `module`)
  - Create `tsconfig.json` (strict mode, ES2022 target)
  - Create `SKILL.md` skeleton (frontmatter only: `name: neuro-memory`, `description: ...`)
  - Create `neuro-memory.yaml` skeleton (placeholder, full content in Task 5)
  - Verify `bun install` works (install `js-yaml`, `uuid`, `better-sqlite3` if needed; prefer `bun:sqlite`)

  **Must NOT do**:
  - Don't implement any business logic yet
  - Don't publish to npm

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple file creation and configuration setup
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**: All — no domain-specific skill needed for scaffolding

  **Parallelization**:
  - **Can Run In Parallel**: NO (foundation for all other tasks)
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 2-5, 6-18
  - **Blocked By**: None (can start immediately)

  **References**:
  - Existing skill at `~/.agents/skills/web-access/SKILL.md` — directory structure and SKILL.md frontmatter pattern to follow
  - The `.skill-lock.json` file may not exist until skills are registered; this is informational context

  **Acceptance Criteria**:
  - [ ] TDD: `test/scaffold.test.ts` verifies directory structure exists
  - [ ] `ls ~/.agents/skills/neuro-memory/` returns non-empty with expected structure

  **QA Scenarios**:
  ```
  Scenario: Verify project structure exists
    Tool: Bash
    Preconditions: None (project should be scaffolded)
    Steps:
      1. ls ~/.agents/skills/neuro-memory/src/
      2. ls ~/.agents/skills/neuro-memory/scripts/
      3. ls ~/.agents/skills/neuro-memory/data/
      4. ls ~/.agents/skills/neuro-memory/.sisyphus/evidence/
      5. ls ~/.agents/skills/neuro-memory/package.json
      6. ls ~/.agents/skills/neuro-memory/tsconfig.json
      7. ls ~/.agents/skills/neuro-memory/SKILL.md
    Expected Result: All files and directories exist
    Evidence: .sisyphus/evidence/neuro-memory/task-1-structure.txt

  Scenario: Bun project initializes
    Tool: Bash
    Preconditions: package.json exists
    Steps:
      1. cd ~/.agents/skills/neuro-memory/ && bun install
      2. echo $?
    Expected Result: bun install succeeds (exit code 0), node_modules/ created
    Evidence: .sisyphus/evidence/neuro-memory/task-1-bun-install.txt
  ```

  **Commit**: YES — `chore(neuro-memory): scaffold project structure and config`

- [x] 2. **Database Schema + Migration System**

  **What to do**:
  - Design the 3-table schema:
    - `categories(id INTEGER PK, name TEXT UNIQUE, created_at INTEGER, last_used_at INTEGER)`
    - `subcategories(id INTEGER PK, name TEXT UNIQUE, category_id INTEGER FK, created_at INTEGER, last_used_at INTEGER)`
    - `memories(id INTEGER PK, content TEXT, summary TEXT, content_hash TEXT UNIQUE, relevance REAL DEFAULT 0.5, subcategory_id INTEGER FK, turn_id TEXT, session_id TEXT, created_at INTEGER, last_accessed_at INTEGER, last_reinforced_at INTEGER, reinforcement_count INTEGER DEFAULT 0)`
  - Create `schema_version` table for migrations
  - Create `src/db/schema.ts` with table definitions and migration runner
  - Create `src/db/init.ts` — initializes DB, runs migrations, enables WAL mode
  - Use `bun:sqlite` for SQLite implementation

  **Must NOT do**:
  - Don't implement business logic yet
  - Don't create adapter interface yet (Task 9)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Schema design is well-defined, implementation straightforward
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**: All — standard SQL + Bun SQLite

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Task 1)
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 6, 7, 9, 10, 11
  - **Blocked By**: Task 1

  **References**:
  - Bun SQLite docs: `https://bun.sh/docs/api/sqlite`
  - SQLite WAL mode: `https://www.sqlite.org/wal.html`

  **Acceptance Criteria**:
  - [ ] TDD: `test/db/schema.test.ts` tests:
    - Creating all 3 tables succeeds
    - WAL mode is enabled after init
    - schema_version table is created with version=1
    - Invalid SQL statements are handled gracefully
  - [ ] `bun test test/db/schema.test.ts` → PASS

  **QA Scenarios**:
  ```
  Scenario: Database initializes with correct schema
    Tool: Bash
    Preconditions: DB doesn't exist at data/memory.db
    Steps:
      1. cd ~/.agents/skills/neuro-memory/ && bun run src/db/init.ts
      2. sqlite3 data/memory.db ".tables"  — should show categories, subcategories, memories, schema_version
      3. sqlite3 data/memory.db "PRAGMA journal_mode;" — should show "wal"
      4. sqlite3 data/memory.db "SELECT version FROM schema_version;" — should show 1
    Expected Result: All tables created, WAL mode active, version=1
    Evidence: .sisyphus/evidence/neuro-memory/task-2-schema.txt

  Scenario: Schema migration works
    Tool: Bash
    Preconditions: DB at version 1
    Steps:
      1. cd ~/.agents/skills/neuro-memory/ && bun run src/db/migrate.ts
      2. sqlite3 data/memory.db "SELECT version FROM schema_version;"
    Expected Result: Version advances (or stays at 1 if no pending migration)
    Evidence: .sisyphus/evidence/neuro-memory/task-2-migration.txt
  ```

  **Commit**: YES — `feat(neuro-memory): add database schema with migration system`

- [x] 3. **Config Parser + Validation**

  **What to do**:
  - Create `src/config.ts` that reads `neuro-memory.yaml`
  - Define TypeScript interface `NeuroMemoryConfig` with all parameters:
    ```typescript
    interface NeuroMemoryConfig {
      db: {
        type: 'sqlite' | 'postgres' | 'duckdb' | 'mysql' | 'mariadb';
        sqlite_path: string;  // default: "~/.agents/skills/neuro-memory/data/memory.db"
        postgres_url?: string;
        // ...
      };
      memory: {
        max_entries: number;  // default: 5000
        max_token_per_entry: number;  // default: 1024
        max_categories: number;  // default: 50
        max_subcategories_per_category: number;  // default: 100
        max_subcategory_links: number;  // default: 3 (categories a subcategory can link to)
        max_subcategory_per_memory: number;  // default: 10
      };
      retrieval: {
        relevance_threshold: number;  // default: 0.75
        max_results: number;  // default: 3
        timeout_ms: number;  // default: 3000
      };
      ebbinghaus: {
        half_life_hours: number;  // default: 24
        min_relevance: number;  // default: 0.1
        reinforcement_boost: number;  // default: 0.15
        prune_interval_hours: number;  // default: 1
      };
      summarization: {
        model: string;  // default: "" (use same as main agent)
        prompt_template: string;  // default: built-in prompt
      };
    }
    ```
  - Implement validation: all required fields, type checking, range checks
  - Provide a `getDefaultConfig()` and `loadConfig(path?)` function
  - Sensible defaults for ALL fields

  **Must NOT do**:
  - Don't implement YAML parser from scratch — use `js-yaml`
  - Don't validate against schema file (just code-level validation)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Well-defined data structure, straightforward validation logic
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**: All — standard TS config parsing

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Task 1)
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 6, 7, 8, 13-16
  - **Blocked By**: Task 1

  **References**:
  - js-yaml docs: `https://github.com/nodeca/js-yaml`

  **Acceptance Criteria**:
  - [ ] TDD: `test/config.test.ts` tests:
    - Default config loads with all fields present
    - Invalid YAML throws clear error
    - Missing required field throws clear error  
    - Range violations (e.g., half_life_hours=0) are caught
    - Custom config file overrides defaults correctly
  - [ ] `bun test test/config.test.ts` → PASS

  **QA Scenarios**:
  ```
  Scenario: Default config loads successfully
    Tool: Bash
    Preconditions: neuro-memory.yaml exists with default values
    Steps:
      1. cd ~/.agents/skills/neuro-memory/ && bun run -e "const {loadConfig}=require('./src/config.ts'); console.log(JSON.stringify(loadConfig()))"
    Expected Result: Complete config object printed, all fields present with defaults
    Evidence: .sisyphus/evidence/neuro-memory/task-3-default-config.txt

  Scenario: Malformed config returns clear error
    Tool: Bash
    Preconditions: Create a temp file with invalid YAML
    Steps:
      1. echo "invalid: : yaml" > /tmp/bad-config.yaml
      2. cd ~/.agents/skills/neuro-memory/ && bun run -e "const {loadConfig}=require('./src/config.ts'); try{loadConfig('/tmp/bad-config.yaml')}catch(e){console.log(e.message)}"
    Expected Result: Clear error message indicating YAML parse failure
    Evidence: .sisyphus/evidence/neuro-memory/task-3-bad-config.txt
  ```

  **Commit**: YES — `feat(neuro-memory): implement config parser and validation`

- [x] 4. **Content Hashing + Dedup Module**

  **What to do**:
  - Create `src/hash.ts`:
    - `computeContentHash(content: string): string` — SHA-256 hash of normalized content (trim, lowercase)
    - `findDuplicate(db, hash): Memory | null` — checks if hash exists in memories table
    - `reinforceMemory(db, memoryId): void` — updates `last_reinforced_at`, increments `reinforcement_count`, boosts `relevance`
  - Content normalization: strip extra whitespace, trim, lowercase (so "Hello World" and "  hello world  " dedup)
  - Use Bun's built-in `crypto.subtle` for SHA-256

  **Must NOT do**:
  - Don't call LLM for hashing decisions
  - Don't implement fuzzy matching (exact hash match only)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small, pure-function module with clear I/O
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**: All — standard crypto + string operations

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Task 1)
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 7
  - **Blocked By**: Task 1

  **References**:
  - Bun crypto: `https://bun.sh/docs/api/hashing`

  **Acceptance Criteria**:
  - [ ] TDD: `test/hash.test.ts` tests:
    - Same content produces same hash
    - Different content produces different hash
    - Content normalization (trim/lowercase) works
    - Reinforcement increments count and boosts relevance
  - [ ] `bun test test/hash.test.ts` → PASS

  **QA Scenarios**:
  ```
  Scenario: Content hashing is deterministic
    Tool: Bash
    Preconditions: None
    Steps:
      1. cd ~/.agents/skills/neuro-memory/ && bun run -e "const {computeContentHash}=require('./src/hash.ts'); console.log(computeContentHash('test content'))"
      2. Run the same command again
    Expected Result: Same hash output both times
    Evidence: .sisyphus/evidence/neuro-memory/task-4-hash.txt

  Scenario: Normalization catches near-duplicate
    Tool: Bash
    Preconditions: None
    Steps:
      1. cd ~/.agents/skills/neuro-memory/ && bun run -e "const {computeContentHash}=require('./src/hash.ts'); const h1=computeContentHash('Hello World'); const h2=computeContentHash('  hello world  '); console.log('match:', h1===h2)"
    Expected Result: match: true (normalization makes them equal)
    Evidence: .sisyphus/evidence/neuro-memory/task-4-normalize.txt
  ```

  **Commit**: YES — `feat(neuro-memory): implement content hashing and dedup`

- [x] 5. **YAML Default Config File**

  **What to do**:
  - Create `neuro-memory.yaml` at skill root with ALL configurable parameters
  - Include extensive comments explaining each parameter
  - Include examples and sensible ranges
  - Structure matches the TypeScript interface from Task 3

  **Must NOT do**:
  - Don't implement config parsing (delegated to Task 3)
  - Don't reference non-existent features

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Straightforward YAML writing with comments
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**: All

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4 — after Task 1)
  - **Blocks**: Tasks 13-16
  - **Blocked By**: Task 1

  **References**:
  - Config interface spec from Task 3

  **Acceptance Criteria**:
  - [ ] File exists at `~/.agents/skills/neuro-memory/neuro-memory.yaml`
  - [ ] Passes `bun run src/cli.ts validate` (Task 16)
  - [ ] All parameters documented with comments

  **QA Scenarios**:
  ```
  Scenario: Default config YAML is syntactically valid
    Tool: Bash
    Preconditions: neuro-memory.yaml created
    Steps:
      1. cd ~/.agents/skills/neuro-memory/ && bun run -e "const yaml=require('js-yaml'); const fs=require('fs'); const doc=yaml.load(fs.readFileSync('neuro-memory.yaml','utf8')); console.log(Object.keys(doc).join(','))"
    Expected Result: YAML parses without error, shows top-level keys
    Evidence: .sisyphus/evidence/neuro-memory/task-5-yaml-parse.txt
  ```

  **Commit**: YES — `feat(neuro-memory): add default YAML config file`

- [x] 6. **Category/Subcategory CRUD Operations**

  **What to do**:
  - Create `src/categories.ts` with:
    - `createCategory(db, name)` — inserts if not exists, returns id
    - `getAllCategories(db)` — returns all with subcategory counts
    - `getCategoryById(db, id)`
    - `findOrCreateCategory(db, name)` — dedup by normalized name
    - `createSubcategory(db, name, categoryId)` — inserts with FK
    - `getSubcategoriesByCategory(db, categoryId)`
    - `linkSubcategoryToCategory(db, subcategoryId, categoryId)` — for cross-linking (max 3 links)
    - `deleteCategory(db, id)` — cascade deletes subcategories and memories
    - `deleteSubcategory(db, id)` — cascade deletes memories
    - `getCategoryCount(db)` — for cap enforcement
    - `getSubcategoryCount(db, categoryId)` — for cap enforcement
  - All operations validate caps (50 categories, 100 subcategories per parent)
  - Dynamic category creation from LLM classification (used by Task 12/14)

  **Must NOT do**:
  - Don't implement LLM classification logic (Task 12)
  - Don't implement memory-specific logic (Task 7)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Significant CRUD logic with multiple edge cases (cascade deletes, cap enforcement, cross-linking)
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**: All — standard SQL/TS patterns

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Tasks 2, 3, 4)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 12
  - **Blocked By**: Tasks 2, 3, 4

  **References**:
  - Schema from Task 2
  - Config for cap values from Task 3

  **Acceptance Criteria**:
  - [ ] TDD: `test/categories.test.ts` tests:
    - Create/list/delete categories
    - Create/list/delete subcategories
    - Category cap (50) enforced
    - Subcategory cap (100) enforced
    - Cross-linking (max 3 links) enforced
    - Cascade delete: deleting category removes subcategories
    - findOrCreateCategory dedup with normalized names
  - [ ] `bun test test/categories.test.ts` → PASS

  **QA Scenarios**:
  ```
  Scenario: Create category and subcategory
    Tool: Bash
    Preconditions: Empty DB
    Steps:
      1. cd ~/.agents/skills/neuro-memory/ && bun run src/cli.ts insert-category "test-cat"
      2. bun run src/cli.ts insert-subcategory "test-sub" --category "test-cat"
      3. bun run src/cli.ts list-categories
    Expected Result: Shows "test-cat" with 1 subcategory
    Evidence: .sisyphus/evidence/neuro-memory/task-6-crud.txt

  Scenario: Category cap enforcement
    Tool: Bash
    Preconditions: DB with 50 categories already
    Steps:
      1. cd ~/.agents/skills/neuro-memory/ && bun run src/cli.ts insert-category "overflow-cat"
    Expected Result: Error message indicating category limit reached
    Evidence: .sisyphus/evidence/neuro-memory/task-6-cap.txt
  ```

  **Commit**: YES — `feat(neuro-memory): implement category/subcategory CRUD`

- [x] 7. **Memory Entry CRUD with Cap Enforcement**

  **What to do**:
  - Create `src/memories.ts` with:
    - `insertMemory(db, {content, summary, contentHash, subcategoryId, relevance, turnId, sessionId})` — creates new entry
    - `getMemoryById(db, id)`
    - `searchMemories(db, {keyword?, subcategoryId?, minRelevance?, limit?})` — basic search by keyword in content/summary
    - `deleteMemory(db, id)`
    - `getMemoryCount(db)` — for cap check
    - `getMemoriesBySubcategory(db, subcategoryId)`
    - `updateRelevance(db, id, newRelevance)` — used by Ebbinghaus
    - `updateLastAccessed(db, id)` — update timestamps
    - Hard cap check: before insert, if count >= max_entries → prune lowest relevance entries
  - Use content hash for dedup (if hash exists, call `reinforceMemory` from Task 4 instead of insert)

  **Must NOT do**:
  - Don't implement Ebbinghaus-specific logic (Task 8)
  - Don't implement LLM classification (Task 12)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Core data operations with cap enforcement, dedup integration, multiple search dimensions
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**: All

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Tasks 2, 3, 4)
  - **Parallel Group**: Wave 2
  - **Blocks**: Tasks 13, 14
  - **Blocked By**: Tasks 2, 3, 4

  **References**:
  - Hash/dedup module from Task 4
  - Config for max_entries from Task 3

  **Acceptance Criteria**:
  - [ ] TDD: `test/memories.test.ts` tests:
    - Insert memory with all fields
    - Search by keyword in content
    - Content hash dedup: insert same content twice → reinforce, not duplicate
    - Cap enforcement: insert at 5000 → triggers automatic prune
    - Delete cascades correctly when subcategory deleted
  - [ ] `bun test test/memories.test.ts` → PASS

  **QA Scenarios**:
  ```
  Scenario: Insert and search memory
    Tool: Bash
    Preconditions: DB with test-category/test-subcategory created
    Steps:
      1. cd ~/.agents/skills/neuro-memory/ && bun run src/cli.ts insert --content "Python is a programming language" --summary "Python overview" --subcategory "test-sub" --relevance 0.8
      2. bun run src/cli.ts query --keyword "Python"
    Expected Result: Memory found with relevance 0.8
    Evidence: .sisyphus/evidence/neuro-memory/task-7-insert.txt

  Scenario: Dedup by content hash → reinforcement
    Tool: Bash
    Preconditions: Same memory already inserted
    Steps:
      1. cd ~/.agents/skills/neuro-memory/ && bun run src/cli.ts insert --content "Python is a programming language" --summary "Python overview" --subcategory "test-sub" --relevance 0.8
      2. bun run src/cli.ts query --keyword "Python" --show-reinforcements
    Expected Result: Only 1 entry found, reinforcement_count incremented
    Evidence: .sisyphus/evidence/neuro-memory/task-7-dedup.txt
  ```

  **Commit**: YES — `feat(neuro-memory): implement memory CRUD with cap enforcement`

- [x] 8. **Ebbinghaus Decay Function + Pruning Scheduler**

  **What to do**:
  - Create `src/ebbinghaus.ts`:
    - `calculateRelevance(baseRelevance, halfLifeHours, hoursSinceLastAccess): number` — decay function: `relevance = baseRelevance * e^(-ln(2) * hoursSinceLastAccess / halfLifeHours)`
    - `getReinforcementBoost(reinforcementCount, baseBoost): number` — each reinforcement adds a diminishing boost
    - `getMemoriesToPrune(db, config): Memory[]` — returns memories with relevance below `min_relevance` threshold, sorted by relevance ascending
    - `pruneMemories(db, config): number` — deletes low-relevance memories, returns count deleted
    - `pruneOrphanCategories(db): void` — deletes categories/subcategories with no memories left
    - `runMaintenance(db, config): {pruned, categoriesDeleted, timeElapsed}` — full maintenance routine
  - Pure math/logic — no LLM calls
  - Config-driven: half_life_hours, min_relevance, reinforcement_boost, prune_interval_hours

  **Must NOT do**:
  - Don't add complex eviction policies (LRU/LFU) — Ebbinghaus + cap only
  - Don't call LLM for decay decisions

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Math-heavy logic (exponential decay), needs thorough edge case handling
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**: All

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Task 3)
  - **Parallel Group**: Wave 2
  - **Blocks**: Tasks 14, 15
  - **Blocked By**: Task 3

  **References**:
  - Ebbinghaus forgetting curve formula: `R = e^(-t/S)` where S is the relative strength of memory
  - Config for all Ebbinghaus parameters from Task 3

  **Acceptance Criteria**:
  - [ ] TDD: `test/ebbinghaus.test.ts` tests:
    - calculateRelevance: recent memory (t=0) has full relevance
    - calculateRelevance: old memory (t=halfLife) has 0.5 relevance
    - calculateRelevance: halfLife=0 throws error or returns 0
    - getReinforcementBoost: first reinforcement gives base boost
    - getReinforcementBoost: subsequent boosts have diminishing returns
    - getMemoriesToPrune: returns only memories below min_relevance
    - pruneMemories: deletes only low-relevance memories, returns correct count
    - pruneOrphanCategories: removes categories with 0 memories
  - [ ] `bun test test/ebbinghaus.test.ts` → PASS

  **QA Scenarios**:
  ```
  Scenario: Ebbinghaus decay at t=0
    Tool: Bash
    Preconditions: None
    Steps:
      1. cd ~/.agents/skills/neuro-memory/ && bun run -e "const {calculateRelevance}=require('./src/ebbinghaus.ts'); console.log(calculateRelevance(1.0, 24, 0))"
    Expected Result: 1.0 (no decay at t=0)
    Evidence: .sisyphus/evidence/neuro-memory/task-8-decay-zero.txt

  Scenario: Prune removes low relevance memories
    Tool: Bash
    Preconditions: DB has some very old, low-relevance memories
    Steps:
      1. cd ~/.agents/skills/neuro-memory/ && bun run src/cli.ts prune --dry-run
    Expected Result: Shows list of memories that would be deleted, with their relevance scores
    Evidence: .sisyphus/evidence/neuro-memory/task-8-prune-dryrun.txt
  ```

  **Commit**: YES — `feat(neuro-memory): implement Ebbinghaus decay and pruning`

- [x] 9. **SQLite DB Adapter + Adapter Interface**

  **What to do**:
  - Create `src/db/adapter.ts` — abstract interface `DBAdapter`:
    ```typescript
    interface DBAdapter {
      init(): Promise<void>;
      close(): Promise<void>;
      // Categories
      createCategory(name: string): Promise<number>;
      getAllCategories(): Promise<Category[]>;
      getCategoryCount(): Promise<number>;
      deleteCategory(id: number): Promise<void>;
      // Subcategories
      createSubcategory(name: string, categoryId: number): Promise<number>;
      getSubcategoriesByCategory(categoryId: number): Promise<Subcategory[]>;
      linkSubcategoryToCategory(subcategoryId: number, categoryId: number): Promise<void>;
      deleteSubcategory(id: number): Promise<void>;
      // Memories
      insertMemory(memory: MemoryInput): Promise<number>;
      searchMemories(query: SearchQuery): Promise<Memory[]>;
      getMemoryById(id: number): Promise<Memory | null>;
      getMemoryCount(): Promise<number>;
      updateRelevance(id: number, relevance: number): Promise<void>;
      updateLastAccessed(id: number): Promise<void>;
      deleteMemory(id: number): Promise<void>;
      // Maintenance
      getMemoriesToPrune(minRelevance: number): Promise<Memory[]>;
      pruneOrphanCategories(): Promise<number>;
      runQuery(sql: string, params?: any[]): Promise<any>;
    }
    ```
  - Create `src/db/sqlite-adapter.ts` — implements `DBAdapter` using `bun:sqlite`
  - Wrap `bun:sqlite` synchronous API in async interface for future compatibility with network DBs
  - Enable WAL mode on init
  - Use prepared statements for performance

  **Must NOT do**:
  - Don't implement other DB adapters yet (Tasks 10, 11)
  - Don't implement business logic that belongs in Tasks 6-8

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Interface design + SQLite implementation, needs good abstraction for future DB backends
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**: All

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Tasks 2)
  - **Parallel Group**: Wave 2
  - **Blocks**: Tasks 10, 11
  - **Blocked By**: Task 2

  **References**:
  - Schema from Task 2
  - Bun SQLite docs: `https://bun.sh/docs/api/sqlite`

  **Acceptance Criteria**:
  - [ ] TDD: `test/db/adapter.test.ts` tests:
    - Adapter interface defined with all required methods
    - SQLiteAdapter implements all interface methods
    - Init creates tables and enables WAL
    - CRUD operations work through the interface
    - Prepared statements used for all queries
  - [ ] `bun test test/db/adapter.test.ts` → PASS

  **QA Scenarios**:
  ```
  Scenario: SQLite adapter CRUD through interface
    Tool: Bash
    Preconditions: Clean DB
    Steps:
      1. cd ~/.agents/skills/neuro-memory/ && bun run -e "const {SQLiteAdapter}=require('./src/db/sqlite-adapter'); const db=new SQLiteAdapter(); await db.init(); const id=await db.createCategory('test'); console.log('created:', id); const cats=await db.getAllCategories(); console.log('categories:', cats.length); await db.close()"
    Expected Result: Category created and retrieved successfully
    Evidence: .sisyphus/evidence/neuro-memory/task-9-adapter.txt
  ```

  **Commit**: YES — `feat(neuro-memory): implement SQLite DB adapter`

- [x] 10. **PostgreSQL DB Adapter**

  **What to do**:
  - Create `src/db/postgres-adapter.ts` — implements `DBAdapter` for PostgreSQL
  - Use `pg` npm package for PostgreSQL client
  - Connect via config URL: `postgres://user:pass@host:port/dbname`
  - Create equivalent schema (with SERIAL instead of INTEGER PRIMARY KEY, etc.)
  - Handle connection pooling (min 1, max 5 connections)
  - Handle connection errors and retry (max 3 retries, 1s delay)

  **Must NOT do**:
  - Don't modify the interface (must match Task 9 exactly)
  - Don't implement PostgreSQL-specific optimizations (Phase 1: just works)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: PostgreSQL integration requires async handling, connection management, SQL dialect differences
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**: All

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 11)
  - **Parallel Group**: Wave 2
  - **Blocks**: Tasks 13-15
  - **Blocked By**: Task 9

  **References**:
  - `pg` npm package: `https://node-postgres.com/`
  - PostgreSQL SERIAL type for auto-increment

  **Acceptance Criteria**:
  - [ ] TDD: `test/db/postgres-adapter.test.ts` tests:
    - Implements all DBAdapter methods
    - Schema creation works (same tables as SQLite)
    - Connection pooling configured
    - Connection failure handled gracefully
  - [ ] `bun test test/db/postgres-adapter.test.ts` → PASS (skips if no PG available)

  **QA Scenarios**:
  ```
  Scenario: PostgreSQL adapter class exists and implements interface
    Tool: Bash
    Preconditions: None
    Steps:
      1. cd ~/.agents/skills/neuro-memory/ && bun run -e "const {PostgresAdapter}=require('./src/db/postgres-adapter'); const a=new PostgresAdapter(); console.log('implements:', typeof a.init === 'function' && typeof a.createCategory === 'function')"
    Expected Result: implements: true
    Evidence: .sisyphus/evidence/neuro-memory/task-10-pg-stub.txt
  ```

  **Commit**: YES — `feat(neuro-memory): implement PostgreSQL DB adapter`

- [x] 11. **Stub DuckDB/MySQL/MariaDB Adapters**

  **What to do**:
  - Create stub adapter files:
    - `src/db/duckdb-adapter.ts` — Stub/throws NotImplementedError, documents what would be needed
    - `src/db/mysql-adapter.ts` — Stub/throws NotImplementedError
    - `src/db/mariadb-adapter.ts` — Stub/throws NotImplementedError
  - Each stub implements DBAdapter interface but throws `new Error('Not implemented yet')` on all operations
  - Document the potential npm packages needed for each (duckdb, mysql2, mariadb)
  - Update the factory function in `src/db/adapter.ts` to handle these types

  **Must NOT do**:
  - Don't implement actual DB logic for these (scope control)
  - Don't install additional npm packages

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Interface conformance + factory pattern, small but needs understanding of each DB
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**: All

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 10)
  - **Parallel Group**: Wave 2
  - **Blocks**: None
  - **Blocked By**: Task 9

  **References**:
  - DBAdapter interface from Task 9
  - Factory function pattern from Task 9

  **Acceptance Criteria**:
  - [ ] All 3 stub files created
  - [ ] Stubs throw clear "Not implemented" errors
  - [ ] Factory function can instantiate all types
  - [ ] TDD: `test/db/stubs.test.ts` verifies stubs throw NotImplementedError

  **QA Scenarios**:
  ```
  Scenario: DuckDB stub throws clear error
    Tool: Bash
    Preconditions: None
    Steps:
      1. cd ~/.agents/skills/neuro-memory/ && bun run -e "const {createAdapter}=require('./src/db/adapter'); try{await createAdapter('duckdb',{});}catch(e){console.log(e.message)}"
    Expected Result: Error message says "DuckDB adapter not implemented"
    Evidence: .sisyphus/evidence/neuro-memory/task-11-stubs.txt
  ```

  **Commit**: YES — `feat(neuro-memory): stub DuckDB/MySQL/MariaDB adapters`

- [x] 12. **LLM Classification Prompt + Output Validator**

  **What to do**:
  - Create `src/classifier.ts` — the core LLM-driven classification engine:
    - `buildClassificationPrompt(conversationTurn: string, existingCategories: Category[]): string` — builds a prompt for the classification subagent
    - `parseClassificationOutput(raw: string): ClassificationResult` — parses and validates LLM JSON output
    - `validateClassificationResult(result: ClassificationResult): {valid: boolean, errors: string[]}` — schema validation
  - ClassificationResult interface:
    ```typescript
    interface ClassificationResult {
      summary: string;  // 1-2 sentence summary, < 1K tokens
      relevance: number;  // 0.0 - 1.0
      categories: Array<{
        category: string;  // existing or new category name
        subcategory: string;  // existing or new subcategory name
        confidence: number;  // 0.0 - 1.0
      }>;
      should_store: boolean;  // false for "hello", "你好", etc.
    }
    ```
  - Classification prompt instructions:
    - "Extract the CORE knowledge/insight from this conversation, not meta-conversation"
    - "Prefer EXISTING categories over creating new ones. Reuse when possible."
    - "Return JSON only, no markdown fences"
    - "If the conversation is greeting/small talk (hello, how are you, who are you), set should_store=false"
    - "Summary must be self-contained (don't reference 'this conversation', instead state the fact)"
    - "Each memory entry must be < 1K tokens"
  - Output validator:
    - Check JSON is valid
    - Check all required fields present
    - Check relevance is within 0-1
    - Check summary length < 1K tokens (configurable)
    - Check categories array is not empty (if should_store=true)
    - Return errors list (don't throw — allow partial recovery)

  **Must NOT do**:
  - Don't call the LLM directly — just build prompts and parse output
  - Don't implement CLI commands (Task 14 does this)
  - Don't implement SKILL.md instructions (Task 17 does this)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Prompt engineering + parser + validator — subtle design work, needs careful edge case handling
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**: All

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Task 6)
  - **Parallel Group**: Wave 2
  - **Blocks**: Tasks 14, 17, 18
  - **Blocked By**: Task 6

  **References**:
  - LLM prompt engineering best practices for structured output
  - ClassificationOutput JSON schema

  **Acceptance Criteria**:
  - [ ] TDD: `test/classifier.test.ts` tests:
    - buildClassificationPrompt includes existing categories in output
    - parseClassificationOutput: valid JSON parses correctly
    - parseClassificationOutput: malformed JSON returns errors, not crash
    - parseClassificationOutput: markdown fences stripped before parsing
    - validateClassificationResult: should_store=false for greeting messages
    - validateClassificationResult: relevance within 0-1
    - validateClassificationResult: empty categories when should_store=false OK
    - validateClassificationResult: empty categories when should_store=true returns error
  - [ ] `bun test test/classifier.test.ts` → PASS
  - [ ] Prompt includes explicit instruction to prefer existing categories

  **QA Scenarios**:
  ```
  Scenario: Greeting content gets should_store=false
    Tool: Bash
    Preconditions: None
    Steps:
      1. cd ~/.agents/skills/neuro-memory/ && bun run -e "const {validateClassificationResult}=require('./src/classifier.ts'); const r=validateClassificationResult({summary:'hello', relevance:0, categories:[], should_store:false}); console.log('valid:', r.valid, 'errors:', r.errors.join(','))"
    Expected Result: valid: true, no errors (greetings allowed to skip storage)
    Evidence: .sisyphus/evidence/neuro-memory/task-12-greeting.txt

  Scenario: Malformed JSON returns useful error
    Tool: Bash
    Preconditions: None
    Steps:
      1. cd ~/.agents/skills/neuro-memory/ && bun run -e "const {parseClassificationOutput}=require('./src/classifier.ts'); const r=parseClassificationOutput('{invalid json}'); console.log('errors:', r.errors.join(','))"
    Expected Result: errors contains useful description of what went wrong
    Evidence: .sisyphus/evidence/neuro-memory/task-12-malformed.txt
  ```

  **Commit**: YES — `feat(neuro-memory): implement LLM classification prompt and validator`

---

### Wave 3 — CLI + Integration Layer

- [x] 13. **CLI Tool — Query Command**

  **What to do**:
  - Create `src/cli.ts` as the main CLI entry point
  - Implement `neuro-memory query` subcommand:
    - `query --keyword "text"` — search memories by keyword
    - `query --category "name"` — list all memories in a category
    - `query --subcategory "name"` — list memories in a specific subcategory
    - `query --relevance 0.5` — only results above relevance threshold
    - `query --limit 10` — max results (default 3)
    - `query --show-reinforcements` — include reinforcement count
  - Output format: JSON by default, human-readable with `--format=table`
  - Load config from default location or `--config` flag
  - Initialize DB from config

  **Must NOT do**:
  - Don't implement insert/prune commands (Tasks 14, 15)
  - Don't implement LLM-based relevance scoring in CLI (this is for debugging)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Straightforward CLI command, mostly wiring existing modules
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**: All

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Tasks 7, 10)
  - **Parallel Group**: Wave 3
  - **Blocks**: Tasks 17, 18
  - **Blocked By**: Tasks 7, 10

  **References**:
  - Memory search functions from Task 7
  - DB adapter from Task 10
  - Config from Task 3

  **Acceptance Criteria**:
  - [ ] TDD: `test/cli-query.test.ts` tests:
    - `query --keyword "test"` returns results
    - `query --keyword "nonexistent"` returns empty set
    - `query --category "nonexistent"` returns empty set
    - `query --limit 0` returns empty set
    - `--format=table` outputs table format
    - Invalid flag returns non-zero exit code
  - [ ] `bun test test/cli-query.test.ts` → PASS

  **QA Scenarios**:
  ```
  Scenario: Query returns results
    Tool: Bash
    Preconditions: DB has at least one memory
    Steps:
      1. cd ~/.agents/skills/neuro-memory/ && bun run src/cli.ts query --keyword "Python"
    Expected Result: JSON array with memories, or empty array if none match
    Evidence: .sisyphus/evidence/neuro-memory/task-13-query.txt

  Scenario: Help flag works
    Tool: Bash
    Preconditions: None
    Steps:
      1. cd ~/.agents/skills/neuro-memory/ && bun run src/cli.ts --help
    Expected Result: Shows usage with all available commands
    Evidence: .sisyphus/evidence/neuro-memory/task-13-help.txt
  ```

  **Commit**: YES — `feat(neuro-memory): implement CLI query command`

- [x] 14. **CLI Tool — Insert/Reinforce Commands**

  **What to do**:
  - Implement `neuro-memory insert` subcommand:
    - `insert --content "text" --summary "text" --category "name" --subcategory "name" --relevance 0.8`
    - `insert --from-file path.json` — batch insert from JSON file
    - `insert --conversation-turn "text"` — the main mode: takes raw conversation text → runs through LLM classifier → stores result
  - Implement `neuro-memory reinforce` subcommand:
    - `reinforce --content-hash "abc123"` — manually reinforce a memory
    - `reinforce --all` — run reinforcement check on all memories
  - Auto-dedup via content hash (if exists → reinforce, don't duplicate)
  - Cap enforcement before insert (if >= 5000 → trigger prune first)

  **Must NOT do**:
  - Don't implement the full `--conversation-turn` flow (needs Task 17 SKILL.md to orchestrate)
  - Don't implement SKILL.md-level logic in CLI (CLI is a tool, SKILL.md is the orchestrator)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Multiple subcommand modes, integration with classifier and memory CRUD
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**: All

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Tasks 7, 8, 10, 12)
  - **Parallel Group**: Wave 3
  - **Blocks**: Tasks 17, 18
  - **Blocked By**: Tasks 7, 8, 10, 12

  **References**:
  - Memory CRUD from Task 7
  - Ebbinghaus reinforcement from Task 8
  - Classifier from Task 12
  - DB adapter from Task 10

  **Acceptance Criteria**:
  - [ ] TDD: `test/cli-insert.test.ts` tests:
    - `insert --content ...` with all fields creates memory
    - `insert --content ...` duplicate content triggers reinforcement
    - `insert --from-file` reads JSON file correctly
    - Cap enforcement: at 5000, insert triggers prune
  - [ ] `bun test test/cli-insert.test.ts` → PASS

  **QA Scenarios**:
  ```
  Scenario: Insert memory with structured fields
    Tool: Bash
    Preconditions: DB initialized
    Steps:
      1. cd ~/.agents/skills/neuro-memory/ && bun run src/cli.ts insert --content "TypeScript is a typed superset of JavaScript" --summary "TypeScript definition" --category "programming" --subcategory "languages" --relevance 0.9
      2. bun run src/cli.ts query --keyword "TypeScript"
    Expected Result: Memory found with relevance 0.9
    Evidence: .sisyphus/evidence/neuro-memory/task-14-insert.txt

  Scenario: Duplicate content triggers reinforcement
    Tool: Bash
    Preconditions: Same content already inserted
    Steps:
      1. cd ~/.agents/skills/neuro-memory/ && bun run src/cli.ts insert --content "TypeScript is a typed superset of JavaScript" --summary "TypeScript definition" --category "programming" --subcategory "languages" --relevance 0.9
    Expected Result: Output says "Memory already exists. Reinforcement applied (+1)."
    Evidence: .sisyphus/evidence/neuro-memory/task-14-reinforce.txt
  ```

  **Commit**: YES — `feat(neuro-memory): implement CLI insert/reinforce commands`

- [x] 15. **CLI Tool — Prune/Maintenance Commands**

  **What to do**:
  - Implement `neuro-memory prune` subcommand:
    - `prune` — executes Ebbinghaus pruning (deletes low-relevance memories)
    - `prune --dry-run` — shows what would be deleted without deleting
    - `prune --force` — skip confirmation
    - `prune --min-relevance 0.2` — override config threshold
  - Implement `neuro-memory status` subcommand:
    - Shows: total entries, total categories, total subcategories
    - Shows: entries by relevance bucket (0-0.25, 0.25-0.5, 0.5-0.75, 0.75-1.0)
    - Shows: last prune time, next scheduled prune
    - Shows: config file path and DB path
  - Implement `neuro-memory maintenance` subcommand:
    - Runs: prune → orphan cleanup → config validation → status report

  **Must NOT do**:
  - Don't implement real-time scheduler (just manual/triggered maintenance)
  - Don't add alerting/cron features

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Clear functionality, mostly wiring existing modules
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**: All

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Tasks 8, 10)
  - **Parallel Group**: Wave 3
  - **Blocks**: None (final task)
  - **Blocked By**: Tasks 8, 10

  **References**:
  - Ebbinghaus pruning from Task 8
  - DB adapter from Task 10

  **Acceptance Criteria**:
  - [ ] TDD: `test/cli-prune.test.ts` tests:
    - `prune --dry-run` returns memory list without deleting
    - `prune` deletes low-relevance memories
    - `status` shows all expected fields
    - `maintenance` runs all steps and reports
  - [ ] `bun test test/cli-prune.test.ts` → PASS

  **QA Scenarios**:
  ```
  Scenario: Status shows system health
    Tool: Bash
    Preconditions: DB has a few entries
    Steps:
      1. cd ~/.agents/skills/neuro-memory/ && bun run src/cli.ts status
    Expected Result: Shows entries count, categories, subcategories, relevance distribution
    Evidence: .sisyphus/evidence/neuro-memory/task-15-status.txt

  Scenario: Dry-run prune shows what would be deleted
    Tool: Bash
    Preconditions: DB has some low-relevance entries
    Steps:
      1. cd ~/.agents/skills/neuro-memory/ && bun run src/cli.ts prune --dry-run
    Expected Result: Lists entries eligible for deletion without actually deleting
    Evidence: .sisyphus/evidence/neuro-memory/task-15-dryrun.txt
  ```

  **Commit**: YES — `feat(neuro-memory): implement CLI prune/maintenance commands`

- [x] 16. **CLI Tool — Config Validation Command**

  **What to do**:
  - Implement `neuro-memory validate` subcommand:
    - `validate` — validates current config file
    - `validate --file path.yaml` — validates specific config file
    - `validate --show-defaults` — shows all default values
  - Validation checks:
    - YAML syntax valid
    - All required fields present
    - Type checks (number fields are numbers, etc.)
    - Range checks (thresholds within 0-1, counts positive, half_life_hours > 0)
    - DB path is writable (if SQLite)
    - All enum values valid (db.type)
  - Output: "Config valid" or list of errors with line numbers

  **Must NOT do**:
  - Don't modify config (read-only validation)
  - Don't implement auto-fix

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Pure validation logic, leverages config parser from Task 3
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**: All

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Tasks 3, 5)
  - **Parallel Group**: Wave 3
  - **Blocks**: None (final task)
  - **Blocked By**: Tasks 3, 5

  **References**:
  - Config parser from Task 3
  - Config interface from Task 3

  **Acceptance Criteria**:
  - [ ] TDD: `test/cli-validate.test.ts` tests:
    - Valid config returns success
    - Invalid YAML returns error with line number
    - Missing field returns clear error
    - Out-of-range value returns clear error
  - [ ] `bun test test/cli-validate.test.ts` → PASS

  **QA Scenarios**:
  ```
  Scenario: Valid config passes validation
    Tool: Bash
    Preconditions: Default neuro-memory.yaml exists
    Steps:
      1. cd ~/.agents/skills/neuro-memory/ && bun run src/cli.ts validate
    Expected Result: "Config valid" (exit code 0)
    Evidence: .sisyphus/evidence/neuro-memory/task-16-valid.txt

  Scenario: Invalid config returns errors
    Tool: Bash
    Preconditions: Create a temp file with invalid config
    Steps:
      1. echo "memory:\n  max_entries: -1" > /tmp/bad-neuro-memory.yaml
      2. cd ~/.agents/skills/neuro-memory/ && bun run src/cli.ts validate --file /tmp/bad-neuro-memory.yaml
    Expected Result: Error message indicating max_entries must be > 0
    Evidence: .sisyphus/evidence/neuro-memory/task-16-invalid.txt
  ```

  **Commit**: YES — `feat(neuro-memory): implement CLI config validation`

- [x] 17. **SKILL.md — Memory Retrieval Instructions**

  **What to do**:
  - Write the RETRIEVAL section of SKILL.md (pseudocode style, Step 1/2/3):
    ```
    ## CRITICAL: Memory Retrieval (BEFORE Every Response)
    
    You MUST follow these steps before EVERY response to a human message.
    Subagents spawned via task() do NOT need to follow this.
    
    Step 1: Load config
    - Read neuro-memory.yaml from your skill directory ($CLAUDE_SKILL_DIR)
    - If parse fails, use safe defaults and proceed
    
    Step 2: Query memory system
    - Run: bun run src/cli.ts query --keyword "<brief summary of current user question>" --limit <max_results> [--relevance <threshold>]
    - Default: limit=3, relevance=0.75
    - Timeout: 3 seconds. If it takes longer, SKIP memory injection.
    
    Step 3: Inject into system prompt
    - If results found: Add section "## RELEVANT MEMORIES\n" with each memory formatted as:
      "[Memory] <summary> | Category: <category> > <subcategory> | Relevance: <score>"
    - If no results or timeout: Proceed without memory injection (this is normal for new topics)
    - Inject BEFORE your response, AFTER the user's message and any other system prompts
    ```
  - Include examples of GOOD and BAD memory injection
  - Include edge cases: first message of session, empty DB, timeout

  **Must NOT do**:
  - Don't mix retrieval and recording instructions (separate sections)
  - Don't add subagent inheritance instructions (memory is main-agent only)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Critical instruction design — must be unambiguous enough for LLM to follow every turn
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**: All

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Tasks 12, 13)
  - **Parallel Group**: Wave 3
  - **Blocks**: None (final task)
  - **Blocked By**: Tasks 12, 13

  **References**:
  - Existing skill examples: web-access SKILL.md (per-turn instructions pattern)
  - Classifier from Task 12
  - CLI query from Task 13

  **Acceptance Criteria**:
  - [ ] REVIEW: SKILL.md retrieval section is reviewed for clarity (no ambiguous instructions)
  - [ ] Every step has a clear "if fail → continue" fallback
  - [ ] Subagents explicitly excluded from memory retrieval
  - [ ] Timeout handling documented

  **QA Scenarios**:
  ```
  Scenario: SKILL.md retrieval section exists and is well-formed
    Tool: Bash
    Preconditions: SKILL.md created
    Steps:
      1. grep -c "Memory Retrieval" ~/.agents/skills/neuro-memory/SKILL.md
      2. grep -c "Step 1" ~/.agents/skills/neuro-memory/SKILL.md
      3. grep -c "Step 2" ~/.agents/skills/neuro-memory/SKILL.md
      4. grep -c "Step 3" ~/.agents/skills/neuro-memory/SKILL.md
    Expected Result: All grep counts >= 1 (retrieval section with 3+ steps)
    Evidence: .sisyphus/evidence/neuro-memory/task-17-skills.txt
  ```

  **Commit**: YES — `feat(neuro-memory): write SKILL.md retrieval instructions`

- [x] 18. **SKILL.md — Memory Recording Instructions**

  **What to do**:
  - Write the RECORDING section of SKILL.md (pseudocode style):
    ```
    ## CRITICAL: Memory Recording (AFTER Every Response)
    
    You MUST follow these steps AFTER EVERY response you send to a human user.
    
    Step 1: Check if recording is needed
    - If the conversation turn is empty/greeting ("hello", "hi", "who are you") → SKIP recording
    - If no substantive information was exchanged → SKIP recording
    - If this is the first turn of a new session with no history → SKIP recording (nothing to summarize yet)
    
    Step 2: Spawn background summarization subagent
    - Use: task(run_in_background=true, category="quick", prompt="...")
    - The subagent prompt should include:
      1. The conversation turn (user message + your response)
      2. Instructions to call: bun run src/cli.ts insert --conversation-turn "<escaped text>"
      3. If classification is unclear, prefer "general" category rather than creating many new ones
    - DO NOT wait for the subagent to complete. Continue to next user message immediately.
    
    Step 3: Subagent freedom
    - The subagent decides: what to summarize, which existing categories to use, whether to create new ones
    - The subagent must output JSON that matches the ClassificationResult format
    - If the summary is low confidence (relevance < 0.3), the subagent may skip storage
    ```
  - Include explicit guard against infinite recursion: "The recording subagent runs WITHOUT this SKILL.md loaded"
  - Include subagent prompt template text

  **Must NOT do**:
  - Don't record subagent conversations (memory isolation by design)
  - Don't attempt to summarize previous sessions (current session only)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Complex orchestration — spawning async subagent with correct prompt, avoiding recursion
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**: All

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Tasks 12, 13, 14)
  - **Parallel Group**: Wave 3
  - **Blocks**: None (final task)
  - **Blocked By**: Tasks 12, 13, 14

  **References**:
  - Classifier from Task 12 for subagent prompt template
  - CLI insert from Task 14
  - Existing subagent patterns: web-access SKILL.md (subagent spawning documentation)

  **Acceptance Criteria**:
  - [ ] REVIEW: Recording section explicitly excludes subagents from inheriting neuro-memory
  - [ ] Subagent prompt template is self-contained (no circular reference to neuro-memory SKILL.md)
  - [ ] Greeting/small talk filter instructions are clear
  - [ ] task(run_in_background=true) syntax is correct

  **QA Scenarios**:
  ```
  Scenario: SKILL.md recording section exists and has correct structure
    Tool: Bash
    Preconditions: SKILL.md created
    Steps:
      1. grep -c "Memory Recording" ~/.agents/skills/neuro-memory/SKILL.md
      2. grep -c "run_in_background=true" ~/.agents/skills/neuro-memory/SKILL.md
      3. grep -c "AFTER Every Response" ~/.agents/skills/neuro-memory/SKILL.md
    Expected Result: All grep counts >= 1
    Evidence: .sisyphus/evidence/neuro-memory/task-18-recording.txt

  Scenario: SKILL.md frontmatter is valid
    Tool: Bash
    Preconditions: SKILL.md exists
    Steps:
      1. head -5 ~/.agents/skills/neuro-memory/SKILL.md
    Expected Result: Valid YAML frontmatter with name: neuro-memory and description
    Evidence: .sisyphus/evidence/neuro-memory/task-18-frontmatter.txt
  ```

  **Commit**: YES — `feat(neuro-memory): write SKILL.md recording instructions`

---

## Final Verification Wave (MANDATORY)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results and wait for explicit user okay.

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run CLI, check DB). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `tsc --noEmit` + `bun test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, `console.log` in prod, commented-out code, unused imports, AI slop (excessive comments, over-abstraction, generic names).
  Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real End-to-End QA** — `unspecified-high`
  Start from clean state. Install the skill to ~/.agents/skills/neuro-memory/. Run EVERY QA scenario from EVERY task — exact steps, capture evidence. Test cross-task integration. Test edge cases: empty DB, 5000-cap overflow, concurrent reads/writes.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do" vs actual diff. Verify 1:1 — everything in spec was built, nothing beyond spec was built. Check "Must NOT do" compliance. Flag cross-task contamination and unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | VERDICT`

---

## Commit Strategy

- **1**: `chore(neuro-memory): scaffold project structure and config`
- **2**: `feat(neuro-memory): add database schema with migration system`
- **3**: `feat(neuro-memory): implement config parser and validation`
- **4**: `feat(neuro-memory): implement content hashing and dedup`
- **5**: `feat(neuro-memory): add default YAML config file`
- **6**: `feat(neuro-memory): implement category/subcategory CRUD`
- **7**: `feat(neuro-memory): implement memory CRUD with cap enforcement`
- **8**: `feat(neuro-memory): implement Ebbinghaus decay and pruning`
- **9**: `feat(neuro-memory): implement SQLite DB adapter`
- **10**: `feat(neuro-memory): implement PostgreSQL DB adapter`
- **11**: `feat(neuro-memory): stub DuckDB/MySQL/MariaDB adapters`
- **12**: `feat(neuro-memory): implement LLM classification prompt and validator`
- **13**: `feat(neuro-memory): implement CLI query command`
- **14**: `feat(neuro-memory): implement CLI insert/reinforce commands`
- **15**: `feat(neuro-memory): implement CLI prune/maintenance commands`
- **16**: `feat(neuro-memory): implement CLI config validation`
- **17**: `feat(neuro-memory): write SKILL.md retrieval instructions`
- **18**: `feat(neuro-memory): write SKILL.md recording instructions`

---

## Success Criteria

### Verification Commands
```bash
# Project structure
ls ~/.agents/skills/neuro-memory/  # Should show SKILL.md, src/, scripts/, neuro-memory.yaml, package.json

# Tests pass
cd ~/.agents/skills/neuro-memory/ && bun test  # All tests pass

# CLI works
cd ~/.agents/skills/neuro-memory/ && bun run src/cli.ts --help  # Shows usage

# DB operations
cd ~/.agents/skills/neuro-memory/ && bun run src/cli.ts query --keyword "test"  # Returns results or empty set
cd ~/.agents/skills/neuro-memory/ && bun run src/cli.ts status  # Shows entry count, category count, last prune

# Ebbinghaus pruning works with dry-run
cd ~/.agents/skills/neuro-memory/ && bun run src/cli.ts prune --dry-run  # Shows what would be deleted

# Config validation
cd ~/.agents/skills/neuro-memory/ && bun run src/cli.ts validate  # Config is valid
```

### Final Checklist
- [ ] All "Must Have" present and verified
- [ ] All "Must NOT Have" absent (verified via code search)
- [ ] All tests pass (`bun test` → 0 failures)
- [ ] CLI tool fully functional (query/insert/status/prune/validate)
- [ ] SKILL.md instructs agent correctly for both retrieval and recording
- [ ] Evidence directory populated with QA scenario results
- [ ] Skill is installed and usable: `npx skills list` shows neuro-memory
