---
name: neuro-memory
description: Persistent neuro-memory system — automatically records conversation knowledge and retrieves relevant context before each response. Runs silently by default (no memory display unless enabled in neuro-memory.yaml).
---

# Neuro-Memory Skill

## Overview

This skill provides persistent memory across conversations. Automatic retrieval (before each
response) and recording (after each response) are handled **silently by the opencode plugin**
(see `plugin/`), NOT by visible agent tool calls. The plugin injects relevant context into the
system prompt and spawns background summarization for you — with zero visibility in the chat.

- Automatic retrieval/recording is controlled by the `display` setting in `neuro-memory.yaml`:
  - `display: false` (default) → fully silent; context injected invisibly, recording runs in the background
  - `display: true` → retrieved memories are surfaced visibly
- This skill only explains the **user-triggered** memory commands below.

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

Automatic memory retrieval (before each response) and recording (after each response) are
handled entirely by the opencode **plugin** (`plugin/`), not by agent-side instructions. The
agent does NOT run memory CLI commands or spawn background subagents for these — that would
be redundant and visible. No agent-side action is required for the automatic pipeline.

The `display` setting in `neuro-memory.yaml` controls whether retrieved memories are surfaced
visibly (`display: true`) or kept fully silent (`display: false`, the default).
