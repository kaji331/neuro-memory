# neuro-memory

> A cross-agent persistent memory skill — automatically records conversation knowledge and retrieves relevant context before each response.

Built with **Bun/TypeScript** + **SQLite**. LLM-driven classification and relevance scoring (no vector embeddings needed).

## Features

- **Automatic Recording** — Each conversation turn is summarized, classified into a 3-tier hierarchy, and stored by a background subagent
- **Contextual Retrieval** — Before each response, relevant past memories are injected into the system prompt
- **3-Tier Classification** — Dynamic categories, subcategories, and memory entries — all created by an LLM classifier, no predefined taxonomy
- **Ebbinghaus Forgetting Curve** — Memories decay naturally; frequently reinforced memories persist longer
- **5000-Entry Cap** — Hard limit with automatic pruning of low-relevance memories
- **Configurable** — YAML config for all parameters (DB type, thresholds, decay rates, etc.)
- **Multiple Database Backends** — SQLite (default), PostgreSQL, with stubs for DuckDB/MySQL/MariaDB
- **CLI Tool** — Full command-line interface: `query`, `insert`, `prune`, `status`, `maintenance`, `validate`

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) >= 1.x

### Install

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/neuro-memory.git
cd neuro-memory

# Install dependencies
bun install

# Run tests
bun test
```

## Agent Installation

### opencode

The skill is automatically discovered when placed in the skills directory:

```bash
# Copy or symlink to the opencode skills directory
ln -s "$(pwd)" ~/.agents/skills/neuro-memory
```

**How it works**: opencode scans `~/.agents/skills/*/SKILL.md` on startup and injects matching skills into the system prompt on every turn. The SKILL.md tells the agent to query memory before each response and record after each response.

### Pi (π)

Pi discovers skills through `~/.pi/agent/skills/`, which is a symlink farm to `~/.agents/skills/`:

```bash
ln -s ~/.agents/skills/neuro-memory ~/.pi/agent/skills/neuro-memory
```

> Already linked? Verify: `ls -la ~/.pi/agent/skills/neuro-memory`

### Claude Code

Claude Code loads skills from `~/.claude/skills/`. Since it doesn't follow symlinks from the shared skills directory, create a copy:

```bash
cp -r ~/.agents/skills/neuro-memory ~/.claude/skills/neuro-memory
```

### Crush

Crush loads skills from `~/.config/crush/skills/`, which is also a symlink farm:

```bash
mkdir -p ~/.config/crush/skills
ln -s ~/.agents/skills/neuro-memory ~/.config/crush/skills/neuro-memory
```

### Verify Installation

```bash
# List all installed skills across agents
ls -d ~/.agents/skills/neuro-memory 2>/dev/null && echo "✅ opencode"
ls -d ~/.pi/agent/skills/neuro-memory 2>/dev/null && echo "✅ Pi"
ls -d ~/.claude/skills/neuro-memory 2>/dev/null && echo "✅ Claude Code"
ls -d ~/.config/crush/skills/neuro-memory 2>/dev/null && echo "✅ Crush"
```

## Configuration

Edit `neuro-memory.yaml` to customize behaviour:

```yaml
db:
  type: sqlite                         # sqlite | postgres | duckdb | mysql | mariadb
  sqlite_path: "~/.agents/skills/neuro-memory/data/memory.db"

memory:
  max_entries: 5000                    # Hard cap (100-100000)
  max_token_per_entry: 1024            # Max tokens per summary (256-4096)
  max_categories: 50                   # Max top-level categories (10-500)

retrieval:
  relevance_threshold: 0.75            # Minimum score for retrieval (0.0-1.0)
  max_results: 3                       # Max memories per query (1-10)
  timeout_ms: 3000                     # Query timeout before skipping

ebbinghaus:
  half_life_hours: 24                  # Half-life of memory relevance
  min_relevance: 0.1                   # Pruning threshold
  reinforcement_boost: 0.15            # Boost on memory reinforcement
```

## CLI Usage

```bash
# Query memories
bun run src/cli.ts query --keyword "typescript" --limit 5
bun run src/cli.ts query --category "programming" --format table

# Insert a memory
bun run src/cli.ts insert \
  --content "TypeScript is a typed superset of JavaScript" \
  --summary "TypeScript definition" \
  --category "programming" \
  --subcategory "languages" \
  --relevance 0.9

# Prune low-relevance memories (dry-run first)
bun run src/cli.ts prune --dry-run
bun run src/cli.ts prune --force

# Show system status
bun run src/cli.ts status

# Validate configuration
bun run src/cli.ts validate
```

## Project Structure

```
neuro-memory/
├── SKILL.md                    # Agent integration instructions
├── neuro-memory.yaml           # Configuration file
├── package.json                # Bun project
├── tsconfig.json               # TypeScript config
├── src/
│   ├── cli.ts                  # CLI entry point
│   ├── config.ts               # Config parser & validation
│   ├── hash.ts                 # Content hashing & dedup (SHA-256)
│   ├── categories.ts           # Category/subcategory CRUD
│   ├── memories.ts             # Memory CRUD with cap enforcement
│   ├── ebbinghaus.ts           # Ebbinghaus forgetting curve & pruning
│   ├── classifier.ts           # LLM classification prompt & validator
│   ├── index.ts                # Module entry
│   └── db/
│       ├── adapter.ts          # DBAdapter interface + factory
│       ├── sqlite-adapter.ts   # SQLite implementation
│       ├── postgres-adapter.ts # PostgreSQL implementation
│       ├── duckdb-adapter.ts   # Stub
│       ├── mysql-adapter.ts    # Stub
│       ├── mariadb-adapter.ts  # Stub
│       ├── schema.ts           # Table definitions
│       ├── init.ts             # DB initialization
│       ├── migrate.ts          # Migration runner
│       └── index.ts            # Barrel export
├── test/                       # Test files (274+ tests)
└── data/
    └── memory.db               # SQLite database (auto-created)
```

## Architecture

```
User Message
    │
    ▼
┌─────────────────────────────────────┐
│  opencode / Pi / Claude / Crush     │
│  (reads SKILL.md every turn)         │
└─────────┬───────────────────────────┘
          │
    ┌─────┴─────┐
    │           │
    ▼           ▼
Retrieval    Recording
(BEFORE)     (AFTER)
    │           │
    │           ▼
    │    task(run_in_background=true)
    │    ┌──────────────────────┐
    │    │ Summarization        │
    │    │ Subagent             │
    │    │  → classify          │
    │    │  → rate relevance    │
    │    │  → insert via CLI    │
    │    └──────────────────────┘
    │
    ▼
┌──────────────────────┐
│  neuro-memory CLI    │
│  src/cli.ts          │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  DBAdapter           │
│  (SQLite / Postgres) │
│                      │
│  3 tables:           │
│  categories          │
│  subcategories       │
│  memories            │
│                      │
│  + Ebbinghaus decay  │
│  + 5000-entry cap    │
└──────────────────────┘
```

## Development

```bash
# Run all tests
bun test

# Run specific test suite
bun test test/categories.test.ts
bun test test/ebbinghaus.test.ts

# TypeScript check (requires tsc installed)
# bun run tsc --noEmit
```

## Roadmap

- [ ] Universal wrapper script for agents without skill systems
- [ ] Memory browser CLI (TUI)
- [ ] DuckDB / MySQL / MariaDB adapters (full implementations)
- [ ] Cross-session memory sharing (multi-user)

## License

MIT
