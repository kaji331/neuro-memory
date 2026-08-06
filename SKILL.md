---
name: neuro-memory
description: Persistent neuro-memory system — automatically records conversation knowledge and retrieves relevant context before each response. Runs silently by default (no memory display unless enabled in neuro-memory.yaml).
user-invocable: true
---

# Neuro-Memory Skill

## Overview

This skill provides persistent memory across conversations. It operates in **dual mode**
depending on the agent platform:

- **opencode**: Automatic retrieval (before each response) and recording (after each
  response) are handled **silently by the neuro-memory plugin**
  (`opencode-neuro-memory-plugin/`), NOT by visible agent tool calls. The plugin injects
  relevant context into the system prompt and spawns background summarization for you —
  with zero visibility in the chat. **No agent-side memory work is needed here.**
- **no-plugin agents** (crush / Pi / Claude Code / others): The skill provides a
  **minimal-visible**, instruction-driven pipeline — bounded retrieval before responding
  and background recording after each turn. See the dual-mode instructions in
  ## Automatic Retrieval & Recording below.

- Automatic retrieval/recording is controlled by the `display` setting in `neuro-memory.yaml`:
  - `display: false` (default) → fully silent; context injected invisibly, recording runs in the background
  - `display: true` → retrieved memories are surfaced visibly
- This skill also explains the **user-triggered** `/neuro-memory` memory management commands below.

IMPORTANT: This skill applies ONLY to conversations with human users. Subagents spawned via task() do NOT need to follow these instructions.

---

## Memory Commands (User-Triggered)

When the user sends a message starting with `/neuro-memory`, treat it as a memory management command. This is a USER-INITIATED request to inspect the memory database.

CRITICAL — ALWAYS apply these rules when handling any `/neuro-memory` command:
1. This command is the sole explicit, visible-by-design way to inspect memory (automatic retrieval/recording is handled silently by the plugin).
2. Just run the relevant CLI command and present the output to the user
3. If the CLI command fails, show the error message to the user plainly — do not invent data

Available commands:

`/neuro-memory` or `/neuro-memory status` or `/neuro-memory stats`
  → Run: cd ~/.agents/skills/neuro-memory && bun run src/cli.ts status
  → Display the full status table (total memories, categories, relevance distribution)

`/neuro-memory help`
  → Display this list of available `/neuro-memory` subcommands (no CLI call needed)

`/neuro-memory query <keyword>` or `/neuro-memory search <keyword>`
  → Run: cd ~/.agents/skills/neuro-memory && bun run src/cli.ts query --keyword "<keyword>" --limit 10 --format table
  → Display the results table. If empty, say "No memories found for '<keyword>'."

`/neuro-memory recent`
  → Run: cd ~/.agents/skills/neuro-memory && bun run src/cli.ts query --limit 5 --format table
  → Display the most recent memories

`/neuro-memory categories`
  → Run: cd ~/.agents/skills/neuro-memory && bun run src/cli.ts status
  → Extract and display the category count and list from the status output

`/neuro-memory top`
  → Run: cd ~/.agents/skills/neuro-memory && bun run src/cli.ts query --relevance 0.8 --limit 5 --format table
  → Display the highest-relevance memories

For any unrecognized subcommand (e.g. `/neuro-memory delete`, `/neuro-memory asdf`):
  → Display the `/neuro-memory help` list and ask the user to choose a valid command
  → Do NOT attempt to guess or run an unknown CLI command

---

## Automatic Retrieval & Recording

This section defines the dual-mode automatic memory pipeline. The agent self-identifies its
platform from the system prompt: if the system prompt identifies you as running in opencode,
follow **GATE 1**. Otherwise (crush, Pi, Claude Code, or any other agent), follow **GATE 2**.

---

### GATE 1 — opencode (unconditional no-op)

If you are running in **opencode**: automatic retrieval and recording are handled SILENTLY
by the neuro-memory plugin (`opencode-neuro-memory-plugin/`). Do **NOT** run
`bun run src/cli.ts query` / `summarize` or spawn memory subagents for per-turn memory
operations. No agent-side memory work is needed here.

The `display` setting in `neuro-memory.yaml` controls whether the plugin surfaces retrieved
memories visibly (`display: true`) or keeps them fully silent (`display: false`, the default).

---

### GATE 2 — no-plugin agents (crush / Pi / Claude Code / others)

**Only apply this gate if you are NOT running in opencode.** The pipeline is instruction-driven
and minimal-visible: bounded retrieval + background recording with no user echo.

#### Retrieval (before responding)

1. Derive the current conversation topic from the user's message.
2. Run **ONE** command from the skill directory `~/.agents/skills/neuro-memory`:

   ```
   bun run src/cli.ts query --keyword "<topic>" --limit 2 --relevance 0.5
   ```

   - Default output is JSON. Do **NOT** use `--format table`.
3. Read the JSON result. If relevant memories are found, incorporate at most 1–2 memories
   as a **brief** context note (1–2 lines) into your answer. Skip if no relevant result.
4. **Output bound**: at most 2 memories / 2 lines of context. Never automatically dump a
   full list or table.

#### Recording (after responding, background-async)

**Skip recording entirely** if this turn:
- Is a `/neuro-memory ...` command, OR
- Contains fewer than 200 characters, OR
- Is a pure greeting / pleasantry with no substantive content.

Otherwise:

1. Write the conversation turn to a temporary file (e.g. `/tmp/neuro-memory-turn-<n>.txt`).
2. Run **ONCE** in the background with output **fully suppressed**:

   ```
   bun run src/cli.ts summarize --input-file <tmp> --config ~/.agents/skills/neuro-memory/neuro-memory.yaml >/dev/null 2>&1
   ```

   Launch as an async background job:
   - **crush**: `bash run_in_background:true` job.
   - **other agents**: use their async/`task(run_in_background=true)` mechanism.
   - The `>/dev/null 2>&1` guarantees no stdout leaks to the chat. Do **NOT** announce the
     recording to the user.
