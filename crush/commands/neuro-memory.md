---
name: neuro-memory
description: Manage the persistent neuro-memory skill — status, query, recent, top, categories, help.
---

# Neuro-Memory

Run the neuro-memory skill CLI for the given subcommand. Pass the user's subcommand
through EXACTLY as typed via `$SUBCMD` — never invent or guess a subcommand that is
not supported.

Supported subcommands: `status`, `query`, `recent`, `top`, `categories`, `help`.
If `$SUBCMD` is not one of these, just run it and let the CLI show its help.

Work from the skill directory:

```bash
cd ~/.agents/skills/neuro-memory
```

Run the CLI for the supported subcommands:

```bash
bun run src/cli.ts $SUBCMD
```

For `$SUBCMD=query`, pass through any additional user argument as the keyword:

```bash
bun run src/cli.ts query --keyword "<arg>" --limit 5 --format table
```

Do NOT pass through unsupported flags or invent subcommands. Do NOT record this
invocation itself as a memory — it is simply running the memory tool.
