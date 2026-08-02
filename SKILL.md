---
name: neuro-memory
description: Persistent neuro-memory system — automatically records conversation knowledge and retrieves relevant context before each response.
---

# Neuro-Memory Skill

## Overview

This skill gives you persistent memory across conversations. It works in TWO automatic steps:

1. **Before each response**: Query the memory database for relevant context from past conversations
2. **After each response**: Spawn a background task to summarize and store the current conversation turn

IMPORTANT: This skill applies ONLY to conversations with human users. Subagents spawned via task() do NOT need to follow these instructions.

---

## Memory Commands (User-Triggered)

When the user sends a message starting with `/memories` (or `/memory`), treat it as a memory management command. This is a USER-INITIATED request to inspect the memory database.

CRITICAL — ALWAYS apply these rules when handling any `/memories` command:
1. Do NOT run memory retrieval (skip the "Memory Retrieval" steps entirely)
2. Do NOT record this conversation turn (skip the "Memory Recording" steps entirely)
3. Just run the relevant CLI command and present the output to the user
4. If the CLI command fails, show the error message to the user plainly — do not invent data

Available commands:

`/memories` or `/memories status` or `/memories stats`
  → Run: cd ~/.agents/skills/neuro-memory && bun run src/cli.ts status
  → Display the full status table (total memories, categories, relevance distribution)

`/memories help`
  → Display this list of available `/memories` subcommands (no CLI call needed)

`/memories query <keyword>` or `/memories search <keyword>`
  → Run: cd ~/.agents/skills/neuro-memory && bun run src/cli.ts query --keyword "<keyword>" --limit 10 --format table
  → Display the results table. If empty, say "No memories found for '<keyword>'."

`/memories recent`
  → Run: cd ~/.agents/skills/neuro-memory && bun run src/cli.ts query --limit 5 --format table
  → Display the most recent memories

`/memories categories`
  → Run: cd ~/.agents/skills/neuro-memory && bun run src/cli.ts status
  → Extract and display the category count and list from the status output

`/memories top`
  → Run: cd ~/.agents/skills/neuro-memory && bun run src/cli.ts query --relevance 0.8 --limit 5 --format table
  → Display the highest-relevance memories

For any unrecognized subcommand (e.g. `/memories delete`, `/memories asdf`):
  → Display the `/memories help` list and ask the user to choose a valid command
  → Do NOT attempt to guess or run an unknown CLI command

---

## Memory Retrieval (BEFORE Each Response)

You MUST follow these steps BEFORE every response to a human message.

### Step 1: Check if retrieval is needed

- If this is the FIRST message in a new session (no prior user messages): SKIP retrieval (nothing to query yet)
- If the user's message starts with `/memories` or `/memory`: SKIP retrieval (memory management commands — see "Memory Commands" section)
- If the query is purely about system configuration or memory management (e.g., "show memory", "clear memory", "memory stats"): SKIP retrieval
- Otherwise: PROCEED to Step 2

### Step 2: Query the memory system

Run this command:

```
bun run src/cli.ts query --keyword "<brief 3-5 word summary of the user's core question/topic>" --limit <max_results> --relevance <threshold>
```

Default values:
- max_results = 3 (from config: retrieval.max_results)
- relevance_threshold = 0.75 (from config: retrieval.relevance_threshold)

Timeout: 3 seconds.

If the command takes longer than 3 seconds: SKIP memory injection (proceed without memories).

If no config file is found or parsing fails, use these safe defaults:
- limit=3, relevance=0.75

If the command errors: SKIP memory injection (proceed without memories).

### Step 3: Process results

- If results found (non-empty array): ADD them to your context → go to Step 4
- If no results or timeout: Proceed normally (this is expected for new topics; the database grows over time)
- If error: Proceed normally (do not retry; do not report the error to the user)

### Step 4: Inject into context

Add this section near the top of your response, after the user message but before your reasoning:

```
## RELEVANT MEMORIES FROM PAST CONVERSATIONS

The following are relevant memories retrieved from your personal memory database.
Use them to inform your response:

[Memory 1] <summary> | Relevance: <score> | Category: <category> > <subcategory>
[Memory 2] <summary> | Relevance: <score> | Category: <category> > <subcategory>
[Memory 3] <summary> | Relevance: <score> | Category: <category> > <subcategory>
```

Format each memory as: `[Memory] <summary> | Category: <category> > <subcategory> | Relevance: <score>`

Common categories include: programming, science, technology, health, food, travel, finance, education, gaming, productivity, etc.

### Examples:

**GOOD (has relevant memories):**
```
## RELEVANT MEMORIES FROM PAST CONVERSATIONS

[Memory] User prefers TypeScript over JavaScript for type safety | Relevance: 0.88 | Category: programming > languages
[Memory] User is working on a memory system for opencode | Relevance: 0.82 | Category: programming > agent-skills
```

**GOOD (no relevant memories):**
(No memory section added. This is fine. Proceed with the response normally.)

**GOOD (first message of session):**
(No memory section added. Nothing to query yet. Proceed with the response normally.)

---

## Memory Recording (AFTER Each Response)

You MUST follow these steps AFTER EVERY response you send to a human user.

### Step 1: Check if recording is needed

SKIP recording if ANY of these conditions are met:
- The user's message starts with `/memories` or `/memory`: these are memory management commands, never record them
- The conversation turn contains ONLY greetings ("hello", "hi", "hey", "你好", "早上好", etc.)
- The conversation turn contains ONLY farewells ("bye", "goodbye", "再见", "see you", etc.)
- The conversation turn is purely about agent identity ("who are you", "what can you do", "你是谁")
- The conversation turn is a simple acknowledgment ("ok", "thanks", "thank you", "好的", "谢谢", "got it")
- The conversation turn contains no substantive information exchange
- The user's message is very short (fewer than 10 characters)

If the conversation contains substantive information: PROCEED to Step 2.

### Step 2: Spawn background summarization subagent

DO NOT wait for this subagent to complete. Spawn it and immediately return to waiting for the next user message.

Use the task() tool with run_in_background=true:

```
task(
  run_in_background=true,
  category="quick",
  prompt="You are a conversation summarization agent for the neuro-memory system.

Your task is to analyze this conversation turn and decide if it contains information worth remembering.

CONVERSATION TURN:
<user message goes here>
<your full response goes here>

INSTRUCTIONS:
1. If this is a greeting, farewell, acknowledgment, or agent identity question: output {\"should_store\": false} and stop immediately.
2. Otherwise, summarize the CORE knowledge/insight in 1-2 sentences. Make the summary self-contained (do NOT say 'this conversation', 'the user', or 'we discussed' — instead say what was learned or decided).
3. Classify it into categories. Use simple English category names like 'programming', 'science', 'food', 'health', 'technology', 'mathematics', 'finance', 'travel', 'education', 'gaming', 'productivity', etc. Use subcategories for finer grouping.
4. Rate relevance 0.0-1.0 based on how useful this information will be in future conversations.
5. Output ONLY valid JSON in this exact format (no markdown fences, no backticks, no extra text):

{\"summary\": \"...\", \"relevance\": 0.85, \"categories\": [{\"category\": \"programming\", \"subcategory\": \"typescript\", \"confidence\": 0.9}], \"should_store\": true}

6. If the content does not fit existing categories, create new ones. Prefer simple, recognizable names.
7. If should_store is true, call this command to store the result:

bun run src/cli.ts insert --summary \"<summary>\" --content \"<full quoted content>\" --category \"<category>\" --subcategory \"<subcategory>\" --relevance <score>

Then output your JSON result.

IMPORTANT: You work WITHOUT the neuro-memory skill loaded. Do NOT attempt to retrieve or use memory yourself. Your ONLY job is to summarize and store this single conversation turn."
)
```

### Important Notes:

- The subagent prompt above is a template. Replace `<user message goes here>` and `<your full response goes here>` with the actual content.
- The subagent runs WITHOUT neuro-memory loaded (task() spawns with clean context) — this prevents infinite recursion.
- If your response was very long and covered multiple distinct topics, consider spawning multiple subagents (one per topic).
- The insert command auto-dedup: if the same content already exists, it reinforces the existing memory instead of duplicating.
- The total memory count is capped at 5000 (configurable: storage.max_memories). Old/low-relevance memories are automatically pruned.

### Step 3: Confirm execution

After spawning the subagent, do NOT wait for it. Do NOT report its status to the user. Simply proceed to wait for the next user message.
