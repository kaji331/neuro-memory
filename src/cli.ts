/**
 * neuro-memory CLI — Unified command-line tool for managing the neuro-memory skill.
 *
 * Usage:
 *   bun run src/cli.ts <command> [options]
 *
 * Commands:
 *   query        Search memories by keyword, category, subcategory, or relevance
 *   insert       Insert a new memory or from file
 *   reinforce    Reinforce one or more existing memories
 *   prune        Delete low-relevance memories
 *   status       Show system status overview
 *   maintenance  Run full maintenance routine (recalculate → prune → orphan cleanup)
 *   validate     Validate config file or show defaults
 *   --help       Show this help message
 *   --version    Show version
 *
 * Global flags:
 *   --config <path>  Override config file path
 *
 * @module
 */

import { createAdapter, type DBAdapter } from "./db/adapter";
import { loadConfig, getDefaultConfig, configToYaml, validateConfig } from "./config";
import { computeContentHash } from "./hash";
import type { NeuroMemoryConfig } from "./config";

// ── Version ───────────────────────────────────────────────────────────────────

const VERSION = "0.1.1";

// ── Arg helpers ───────────────────────────────────────────────────────────────

function getFlag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  const val = args[idx + 1];
  if (val === undefined || val.startsWith("--")) return undefined;
  return val;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

// ── Help ──────────────────────────────────────────────────────────────────────

function showHelp(): void {
  console.log(`neuro-memory CLI v${VERSION}

Usage:
  bun run src/cli.ts <command> [options]
  neuro-memory <command> [options]

Commands:
  query        Search memories by keyword, category, subcategory, or relevance (--all lists all, most-recent first)
  insert       Insert a new memory: --content, --from-file, or --conversation-turn
  reinforce    Reinforce memories: --id, --content-hash, or --all
  prune        Delete low-relevance memories (use --dry-run to preview, --force to skip confirm)
  status       Show memory system overview
  maintenance  Run full maintenance: recalculate → prune → orphan cleanup
  validate     Validate config file (--show-defaults prints default config)

Global flags:
  --config <path>   Override config file path (default: ./neuro-memory.yaml or $CLAUDE_SKILL_DIR/neuro-memory.yaml)
  --help            Show this help message
  --version         Show version

Examples:
  bun run src/cli.ts query --keyword "python"
  bun run src/cli.ts query --category "programming" --format table
  bun run src/cli.ts insert --content "fact" --summary "learned fact" --category "science" --subcategory "physics" --relevance 0.8
  bun run src/cli.ts insert --from-file memories.json
  bun run src/cli.ts reinforce --all
  bun run src/cli.ts prune --dry-run
  bun run src/cli.ts status
  bun run src/cli.ts maintenance
  bun run src/cli.ts validate --show-defaults
`);
}

// ── Helper: format Memory array as table ──────────────────────────────────────

function formatMemoryTable(
  memories: Array<{
    id: number;
    content: string;
    summary: string;
    content_hash: string;
    relevance: number;
    subcategory_id: number;
    reinforcement_count: number;
  }>,
  showReinforcements: boolean = false,
): string {
  if (memories.length === 0) {
    return "No memories found.";
  }

  const lines: string[] = [];
  const headers = ["ID", "Relevance", "Summary", "Content Hash"];
  const colWidths = [
    6,
    10,
    50,
    16,
  ];

  if (showReinforcements) {
    headers.push("Reinf");
    colWidths.push(6);
  }

  // Header
  const header = headers
    .map((h, i) => h.padEnd(colWidths[i]))
    .join("  ");
  const separator = colWidths.map((w) => "─".repeat(w)).join("──");
  lines.push(header);
  lines.push(separator);

  for (const mem of memories) {
    const id = String(mem.id).padEnd(colWidths[0]);
    const rel = mem.relevance.toFixed(4).padEnd(colWidths[1]);
    const summary = (mem.summary.length > colWidths[2] - 3
      ? mem.summary.slice(0, colWidths[2] - 3) + "..."
      : mem.summary).padEnd(colWidths[2]);
    const hash = mem.content_hash.slice(0, 12).padEnd(colWidths[3]);
    let row = `${id}  ${rel}  ${summary}  ${hash}`;
    if (showReinforcements) {
      row += `  ${String(mem.reinforcement_count).padEnd(colWidths[4])}`;
    }
    lines.push(row);
  }

  return lines.join("\n");
}

// ── Query ─────────────────────────────────────────────────────────────────────

async function cmdQuery(db: DBAdapter, args: string[]): Promise<void> {
  const keyword = getFlag(args, "--keyword") || undefined;
  const category = getFlag(args, "--category") || undefined;
  const subcategory = getFlag(args, "--subcategory") || undefined;
  const relevanceStr = getFlag(args, "--relevance");
  const limitStr = getFlag(args, "--limit");
  const format = getFlag(args, "--format");

  const all = hasFlag(args, "--all") || (!keyword && !category && !subcategory);

  const minRelevance = relevanceStr ? parseFloat(relevanceStr) : undefined;
  const limit = limitStr ? parseInt(limitStr, 10) : undefined;

  if (limitStr !== undefined && (isNaN(limit as number) || (limit as number) < 1)) {
    console.error("Error: --limit must be a positive integer");
    process.exit(1);
  }

  let subcategoryId: number | undefined;

  // If --subcategory is given by name, look it up via category
  if (subcategory) {
    // Search all categories' subcategories for the named subcategory
    // Since the adapter doesn't have a findSubcategoryByName, we iterate
    const categories = await db.getAllCategories();
    let foundId: number | null = null;
    for (const cat of categories) {
      const subs = await db.getSubcategoriesByCategory(cat.id);
      for (const sub of subs) {
        if (sub.name.toLowerCase() === subcategory.toLowerCase()) {
          foundId = sub.id;
          break;
        }
      }
      if (foundId !== null) break;
    }
    if (foundId !== null) {
      subcategoryId = foundId;
    } else {
      console.error(`Error: Subcategory "${subcategory}" not found`);
      process.exit(1);
    }
  }

  // If --category is given by name, we use keyword-based search applied after
  // (we'll search by keyword and then look up category via subcategory_id)
  let categorySubIds: number[] | undefined;
  if (category && !subcategory) {
    const cat = await db.findCategoryByName(category);
    if (!cat) {
      console.error(`Error: Category "${category}" not found`);
      process.exit(1);
    }
    const subs = await db.getSubcategoriesByCategory(cat.id);
    categorySubIds = subs.map((s) => s.id);
    if (categorySubIds.length === 0) {
      // Category exists but has no subcategories → no results
      if (format === "table") {
        console.log("No memories found.");
      } else {
        console.log("[]");
      }
      return;
    }
  }

  // Build the search
  const results: Array<{
    id: number; content: string; summary: string; content_hash: string;
    relevance: number; subcategory_id: number; turn_id: string | null;
    session_id: string | null; created_at: number; last_accessed_at: number;
    last_reinforced_at: number; reinforcement_count: number;
  }> = [];

  if (categorySubIds) {
    // Search by each subcategory
    for (const sid of categorySubIds) {
      const mems = await db.searchMemories({
        keyword,
        subcategoryId: sid,
        minRelevance,
        limit: limit,
      });
      results.push(...mems);
    }
    // De-duplicate by id
    const seen = new Set<number>();
    const deduped = results.filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });
    results.length = 0;
    results.push(...deduped);
    // Sort by relevance desc
    results.sort((a, b) => b.relevance - a.relevance);
    if (limit) {
      results.splice(limit);
    }
  } else {
    const mems = await db.searchMemories({
      keyword,
      subcategoryId,
      minRelevance,
      limit: all && minRelevance === undefined ? undefined : limit,
    });
    results.push(...mems);
  }

  // Wordless unfiltered queries present most-recent-first; relevance-filtered
  // queries keep the adapter's relevance ordering.
  if (all && minRelevance === undefined) {
    results.sort((a, b) => b.created_at - a.created_at);
    if (limit) {
      results.splice(limit);
    }
  }

  const showReinforcements = hasFlag(args, "--show-reinforcements");

  if (format === "table") {
    console.log(formatMemoryTable(results, showReinforcements));
  } else {
    // Only include reinforcement_count when --show-reinforcements is set
    if (showReinforcements) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      const stripped = results.map(({ reinforcement_count, ...rest }) => rest);
      console.log(JSON.stringify(stripped, null, 2));
    }
  }
}

// ── Insert ────────────────────────────────────────────────────────────────────

async function cmdInsert(db: DBAdapter, args: string[], config: NeuroMemoryConfig): Promise<void> {
  const content = getFlag(args, "--content");
  const summary = getFlag(args, "--summary");
  const category = getFlag(args, "--category");
  const subcategory = getFlag(args, "--subcategory");
  const relevanceStr = getFlag(args, "--relevance");
  const fromFile = getFlag(args, "--from-file");
  const conversationTurn = getFlag(args, "--conversation-turn");

  if (conversationTurn) {
    // Placeholder: no LLM integration here — just insert as plain content
    console.log("Note: --conversation-turn classification requires LLM integration. Inserting as plain content with relevance=0.5.");
    const hash = await computeContentHash(conversationTurn);

    // Default to a default subcategory (or create one)
    let subId: number;
    try {
      const catResult = await db.findOrCreateCategory("Unclassified");
      const subResult = await db.createSubcategory("General", catResult.id);
      subId = subResult.id;
    } catch {
      // If creation fails, try to find an existing one
      const cats = await db.getAllCategories();
      if (cats.length > 0) {
        const subs = await db.getSubcategoriesByCategory(cats[0].id);
        if (subs.length > 0) {
          subId = subs[0].id;
        } else {
          const subResult = await db.createSubcategory("General", cats[0].id);
          subId = subResult.id;
        }
      } else {
        const catResult = await db.findOrCreateCategory("Unclassified");
        const subResult = await db.createSubcategory("General", catResult.id);
        subId = subResult.id;
      }
    }

    try {
      const result = await db.insertMemory({
        content: conversationTurn,
        summary: conversationTurn.slice(0, 200),
        contentHash: hash,
        relevance: 0.5,
        subcategoryId: subId,
      });
      if (!result.created && result.reinforced) {
        console.log("Memory already exists. Reinforcement applied (+1).");
      }
      console.log(JSON.stringify(result));
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
    return;
  }

  if (fromFile) {
    const { existsSync, readFileSync } = await import("fs");
    if (!existsSync(fromFile)) {
      console.error(`Error: File not found: ${fromFile}`);
      process.exit(1);
    }
    let raw: string;
    try {
      raw = readFileSync(fromFile, "utf-8");
    } catch (err) {
      console.error(`Error reading file: ${(err as Error).message}`);
      process.exit(1);
    }
    let inputs: Array<{
      content: string; summary: string; category: string;
      subcategory: string; relevance?: number;
    }>;
    try {
      inputs = JSON.parse(raw);
    } catch {
      console.error("Error: File must contain valid JSON array");
      process.exit(1);
    }

    if (!Array.isArray(inputs)) {
      console.error("Error: File must contain a JSON array of memory inputs");
      process.exit(1);
    }

    const results: Array<{ id: number; created: boolean; reinforced: boolean }> = [];
    for (const input of inputs) {
      const hash = await computeContentHash(input.content);
      const catResult = await db.findOrCreateCategory(input.category);
      const subResult = await db.createSubcategory(input.subcategory, catResult.id);

      try {
        const result = await db.insertMemory({
          content: input.content,
          summary: input.summary,
          contentHash: hash,
          relevance: input.relevance ?? 0.5,
          subcategoryId: subResult.id,
        });
        results.push(result);
      } catch (err) {
        const memCount = await db.getMemoryCount();
        if (memCount >= config.memory.max_entries) {
          console.log(`Memory cap reached (${config.memory.max_entries}). Run 'prune' to free space.`);
        } else {
          console.error(`Error inserting: ${(err as Error).message}`);
        }
        process.exit(1);
      }
    }
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  // Direct --content insert
  if (!content || !summary || !category || !subcategory) {
    console.error("Error: --content, --summary, --category, and --subcategory are required for direct insert");
    process.exit(1);
  }

  const relevance = relevanceStr ? parseFloat(relevanceStr) : 0.5;
  if (isNaN(relevance) || relevance < 0 || relevance > 1) {
    console.error("Error: --relevance must be a number between 0 and 1");
    process.exit(1);
  }

  const hash = await computeContentHash(content);
  const catResult = await db.findOrCreateCategory(category);
  const subResult = await db.createSubcategory(subcategory, catResult.id);

  try {
    const result = await db.insertMemory({
      content,
      summary,
      contentHash: hash,
      relevance,
      subcategoryId: subResult.id,
    });
    if (!result.created && result.reinforced) {
      console.log("Memory already exists. Reinforcement applied (+1).");
    }
    console.log(JSON.stringify(result));
  } catch (err) {
    const memCount = await db.getMemoryCount();
    if (memCount >= config.memory.max_entries) {
      console.log(`Memory cap reached (${config.memory.max_entries}). Run 'prune' to free space.`);
    } else {
      console.error(`Error: ${(err as Error).message}`);
    }
    process.exit(1);
  }
}

// ── Reinforce ─────────────────────────────────────────────────────────────────

async function cmdReinforce(db: DBAdapter, args: string[], config: NeuroMemoryConfig): Promise<void> {
  const idStr = getFlag(args, "--id");
  const contentHash = getFlag(args, "--content-hash");
  const all = hasFlag(args, "--all");

  if (!idStr && !contentHash && !all) {
    console.error("Error: One of --id, --content-hash, or --all must be specified");
    process.exit(1);
  }

  let reinforced = 0;

  if (idStr) {
    const id = parseInt(idStr, 10);
    if (isNaN(id)) {
      console.error("Error: --id must be a valid integer");
      process.exit(1);
    }
    const mem = await db.getMemoryById(id);
    if (!mem) {
      console.error(`Error: Memory with id ${id} not found`);
      process.exit(1);
    }
    const newRelevance = Math.min(
      mem.relevance + config.ebbinghaus.reinforcement_boost,
      1.0,
    );
    await db.updateRelevance(id, newRelevance);
    reinforced = 1;
  } else if (contentHash) {
    // Search all memories — adapter doesn't have findByHash, so we search by hash substring
    // This is a best-effort; we'll iterate through recent memories
    const mems = await db.searchMemories({ limit: 1000 });
    const match = mems.find((m) => m.content_hash.startsWith(contentHash));
    if (!match) {
      console.error(`Error: No memory found with content hash starting with "${contentHash}"`);
      process.exit(1);
    }
    const newRelevance = Math.min(
      match.relevance + config.ebbinghaus.reinforcement_boost,
      1.0,
    );
    await db.updateRelevance(match.id, newRelevance);
    reinforced = 1;
  } else if (all) {
    // Get all memories (up to reasonable limit) and boost all
    const mems = await db.searchMemories({});
    for (const mem of mems) {
      const newRelevance = Math.min(
        mem.relevance + config.ebbinghaus.reinforcement_boost,
        1.0,
      );
      await db.updateRelevance(mem.id, newRelevance);
    }
    reinforced = mems.length;
  }

  console.log(JSON.stringify({ reinforced }));
}

// ── Prune ─────────────────────────────────────────────────────────────────────

async function cmdPrune(db: DBAdapter, args: string[], config: NeuroMemoryConfig): Promise<void> {
  const dryRun = hasFlag(args, "--dry-run");
  const force = hasFlag(args, "--force");
  const minRelevanceStr = getFlag(args, "--min-relevance");
  const minRelevance = minRelevanceStr
    ? parseFloat(minRelevanceStr)
    : config.ebbinghaus.min_relevance;

  if (minRelevanceStr !== undefined && (isNaN(minRelevance) || minRelevance < 0 || minRelevance > 1)) {
    console.error("Error: --min-relevance must be a number between 0 and 1");
    process.exit(1);
  }

  if (dryRun) {
    const candidates = await db.getMemoriesToPrune(minRelevance);
    console.log(`Would delete ${candidates.length} memories with relevance < ${minRelevance}:`);
    if (candidates.length > 0) {
      // Show up to 20 candidates
      const shown = candidates.slice(0, 20);
      for (const c of shown) {
        console.log(`  [${c.id}] rel=${(c.relevance as number).toFixed(4)} | ${(c.summary || c.content).slice(0, 60)}`);
      }
      if (candidates.length > 20) {
        console.log(`  ... and ${candidates.length - 20} more`);
      }
    }
    console.log(JSON.stringify({ deleted: 0, dry_run: true }));
    return;
  }

  if (!force) {
    const candidates = await db.getMemoriesToPrune(minRelevance);
    if (candidates.length === 0) {
      console.log(JSON.stringify({ deleted: 0, dry_run: false }));
      return;
    }
    console.log(`${candidates.length} memories will be deleted (relevance < ${minRelevance}).`);
    console.log("Use --force to confirm, or --dry-run to preview.");
    console.log(JSON.stringify({ deleted: 0, dry_run: false, confirm_required: true }));
    return;
  }

  const deleted = await db.pruneLowRelevanceMemories(minRelevance);
  console.log(JSON.stringify({ deleted, dry_run: false }));
}

// ── Status ────────────────────────────────────────────────────────────────────

async function cmdStatus(db: DBAdapter, config: NeuroMemoryConfig): Promise<void> {
  const totalMemories = await db.getMemoryCount();
  const categories = await db.getAllCategories();

  let totalSubcategories = 0;
  for (const cat of categories) {
    const subs = await db.getSubcategoriesByCategory(cat.id);
    totalSubcategories += subs.length;
  }

  // Get relevance distribution by querying all memories
  // Use searchMemories without filters to get all
  const allMems = await db.searchMemories({ limit: 100000 });
  const buckets = [0, 0, 0, 0];
  for (const mem of allMems) {
    if (mem.relevance < 0.25) buckets[0]++;
    else if (mem.relevance < 0.5) buckets[1]++;
    else if (mem.relevance < 0.75) buckets[2]++;
    else buckets[3]++;
  }

  const dbType = config.db.type;
  const dbPath = config.db.sqlite_path;
  const configPath = process.env["NEURO_MEMORY_CONFIG_PATH"] || "neuro-memory.yaml";

  console.log("═".repeat(50));
  console.log("  neuro-memory Status");
  console.log("═".repeat(50));
  console.log();
  console.log(`  Total memories:      ${totalMemories}`);
  console.log(`  Categories:           ${categories.length}`);
  console.log(`  Subcategories:        ${totalSubcategories}`);
  console.log();
  console.log("  Relevance Distribution:");
  console.log(`    0.00 – 0.25:  ${buckets[0].toString().padStart(6)}`);
  console.log(`    0.25 – 0.50:  ${buckets[1].toString().padStart(6)}`);
  console.log(`    0.50 – 0.75:  ${buckets[2].toString().padStart(6)}`);
  console.log(`    0.75 – 1.00:  ${buckets[3].toString().padStart(6)}`);
  console.log();
  console.log("  Configuration:");
  console.log(`    Config path:  ${configPath}`);
  console.log(`    DB path:      ${dbPath}`);
  console.log(`    DB type:      ${dbType}`);
  console.log(`    Max entries:  ${config.memory.max_entries}`);
  console.log(`    Half-life:    ${config.ebbinghaus.half_life_hours}h`);
  console.log(`    Min relevance:${config.ebbinghaus.min_relevance}`);
  console.log();
}

// ── Maintenance ───────────────────────────────────────────────────────────────

async function cmdMaintenance(db: DBAdapter, args: string[], config: NeuroMemoryConfig): Promise<void> {
  const force = hasFlag(args, "--force");

  if (!force) {
    console.log("Maintenance will: recalculate relevance → prune low-relevance → prune orphans.");
    console.log("Use --force to execute.");
    return;
  }

  const report = await db.runMaintenance(
    config.ebbinghaus.half_life_hours,
    config.ebbinghaus.reinforcement_boost,
    config.ebbinghaus.min_relevance,
  );

  console.log(JSON.stringify(report));
}

// ── Validate ──────────────────────────────────────────────────────────────────

async function cmdValidate(args: string[], config: NeuroMemoryConfig): Promise<void> {
  const filePath = getFlag(args, "--file");
  const showDefaults = hasFlag(args, "--show-defaults");

  if (showDefaults) {
    console.log(configToYaml(getDefaultConfig()));
    return;
  }

  if (filePath) {
    try {
      const { loadConfig } = await import("./config");
      loadConfig(filePath);
      console.log("Config valid.");
    } catch (err) {
      console.error(`Config invalid: ${(err as Error).message}`);
      process.exit(1);
    }
    return;
  }

  // Validate the loaded config
  const errors = validateConfig(config);
  if (errors.length > 0) {
    console.error("Config invalid:");
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }
  console.log("Config valid.");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  // Handle --version and --help at top level
  if (command === "--version") {
    console.log(`neuro-memory CLI v${VERSION}`);
    return;
  }

  if (command === "--help" || command === undefined) {
    showHelp();
    return;
  }

  // Load config
  const configPath = getFlag(args, "--config");
  let config: NeuroMemoryConfig;
  try {
    config = loadConfig(configPath || undefined);
  } catch (err) {
    console.error(`Config error: ${(err as Error).message}`);
    process.exit(1);
  }

  // Create adapter
  const db = createAdapter(config);

  try {
    await db.init(config);

    switch (command) {
      case "query":
        await cmdQuery(db, args);
        break;
      case "insert":
        await cmdInsert(db, args, config);
        break;
      case "reinforce":
        await cmdReinforce(db, args, config);
        break;
      case "prune":
        await cmdPrune(db, args, config);
        break;
      case "status":
        await cmdStatus(db, config);
        break;
      case "maintenance":
        await cmdMaintenance(db, args, config);
        break;
      case "validate":
        await cmdValidate(args, config);
        break;
      default:
        console.error(`Unknown command: ${command}`);
        showHelp();
        process.exit(1);
    }
  } finally {
    await db.close();
  }
}

// Run main if invoked directly
main().catch((err) => {
  console.error(`Fatal error: ${(err as Error).message}`);
  process.exit(1);
});
