# Config Module Learnings

## Architecture
- Config module uses deep-merge pattern: YAML overrides are shallow-merged into full defaults
- Default config is deep-copied via JSON.parse(JSON.stringify()) to avoid shared references
- Validation returns string[] (empty = valid), called from loadConfig which throws on failure
- Tilde expansion (`~` → `$HOME`) is applied to `db.sqlite_path` after merge

## Key Decisions
- `getDefaultConfig()` returns a deep copy each call to prevent mutation bugs
- `loadConfig()` silently returns defaults when no file found (no error for missing file)
- Config lookup order: explicit path → `$CLAUDE_SKILL_DIR/neuro-memory.yaml` → `./neuro-memory.yaml`
- No external validation libraries; custom `checkNumber()` helper covers range + NaN
- `configToYaml()` uses `sortKeys: true` for deterministic output, `noRefs: true` to avoid YAML anchors

## Patterns
- All interfaces exported for external use
- `type` imports from config.ts keep test files self-contained
- Tests use temp files in `os.tmpdir()` to avoid polluting project dir
- `loadConfig` tested via dynamic import to allow environment variable manipulation
