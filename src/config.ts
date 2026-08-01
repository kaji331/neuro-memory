import yaml from "js-yaml";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface DbConfig {
  type: "sqlite" | "postgres" | "duckdb" | "mysql" | "mariadb";
  sqlite_path: string;
  postgres_url?: string;
}

export interface MemoryConfig {
  max_entries: number;
  max_token_per_entry: number;
  max_categories: number;
  max_subcategories_per_category: number;
  max_subcategory_links: number;
  max_subcategory_per_memory: number;
}

export interface RetrievalConfig {
  relevance_threshold: number;
  max_results: number;
  timeout_ms: number;
}

export interface EbbinghausConfig {
  half_life_hours: number;
  min_relevance: number;
  reinforcement_boost: number;
  prune_interval_hours: number;
}

export interface SummarizationConfig {
  model: string;
  prompt_template: string;
}

export interface NeuroMemoryConfig {
  db: DbConfig;
  memory: MemoryConfig;
  retrieval: RetrievalConfig;
  ebbinghaus: EbbinghausConfig;
  summarization: SummarizationConfig;
}

// ── Default values ──────────────────────────────────────────────────────────

const DEFAULT_CONFIG: NeuroMemoryConfig = {
  db: {
    type: "sqlite",
    sqlite_path: "~/.agents/skills/neuro-memory/data/memory.db",
  },
  memory: {
    max_entries: 5000,
    max_token_per_entry: 1024,
    max_categories: 50,
    max_subcategories_per_category: 100,
    max_subcategory_links: 3,
    max_subcategory_per_memory: 10,
  },
  retrieval: {
    relevance_threshold: 0.75,
    max_results: 3,
    timeout_ms: 3000,
  },
  ebbinghaus: {
    half_life_hours: 24,
    min_relevance: 0.1,
    reinforcement_boost: 0.15,
    prune_interval_hours: 1,
  },
  summarization: {
    model: "",
    prompt_template: "",
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function expandTilde(p: string): string {
  if (p.startsWith("~/")) {
    return resolve(homedir(), p.slice(2));
  }
  return p;
}

/** Deep-merge `override` values into `base`. Only plain objects are merged recursively. */
function deepMerge<T extends Record<string, unknown>>(base: T, override: Partial<T>): T {
  const result = { ...base };
  for (const key of Object.keys(override) as (keyof T)[]) {
    const val = override[key];
    if (val === undefined || val === null) continue;
    if (
      typeof val === "object" &&
      !Array.isArray(val) &&
      typeof base[key] === "object" &&
      !Array.isArray(base[key]) &&
      base[key] !== null
    ) {
      result[key] = deepMerge(base[key] as Record<string, unknown>, val as Record<string, unknown>) as T[keyof T];
    } else {
      result[key] = val as T[keyof T];
    }
  }
  return result;
}

// ── Public API ──────────────────────────────────────────────────────────────

export function getDefaultConfig(): NeuroMemoryConfig {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as NeuroMemoryConfig;
}

export function loadConfig(filePath?: string): NeuroMemoryConfig {
  const resolvedPath = resolveConfigPath(filePath);

  if (!resolvedPath || !existsSync(resolvedPath)) {
    return getDefaultConfig();
  }

  let raw: string;
  try {
    raw = readFileSync(resolvedPath, "utf-8");
  } catch (err) {
    throw new Error(`Cannot read config file at "${resolvedPath}": ${(err as Error).message}`);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = yaml.load(raw) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Invalid YAML in config file "${resolvedPath}": ${(err as Error).message}`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Config file "${resolvedPath}" must contain a YAML mapping (object)`);
  }

  const defaults = getDefaultConfig();
  const merged = deepMerge(defaults as unknown as Record<string, unknown>, parsed) as unknown as NeuroMemoryConfig;

  // Expand tilde in sqlite_path
  merged.db.sqlite_path = expandTilde(merged.db.sqlite_path);

  const errors = validateConfig(merged);
  if (errors.length > 0) {
    throw new Error(`Config validation failed:\n  - ${errors.join("\n  - ")}`);
  }

  return merged;
}

function resolveConfigPath(filePath?: string): string | null {
  if (filePath) return resolve(filePath);

  const envDir = process.env.CLAUDE_SKILL_DIR;
  if (envDir) {
    const envPath = resolve(envDir, "neuro-memory.yaml");
    if (existsSync(envPath)) return envPath;
  }

  const cwdPath = resolve(process.cwd(), "neuro-memory.yaml");
  if (existsSync(cwdPath)) return cwdPath;

  return null;
}

export function validateConfig(config: NeuroMemoryConfig): string[] {
  const errors: string[] = [];

  // ── db ──────────────────────────────────────────────────────────────
  if (!config.db) {
    errors.push("db section is required");
  } else {
    const validTypes = ["sqlite", "postgres", "duckdb", "mysql", "mariadb"];
    if (!validTypes.includes(config.db.type)) {
      errors.push(`db.type must be one of: ${validTypes.join(", ")}`);
    }
    if (typeof config.db.sqlite_path !== "string" || config.db.sqlite_path.trim() === "") {
      errors.push("db.sqlite_path must be a non-empty string");
    }
  }

  // ── memory ──────────────────────────────────────────────────────────
  if (!config.memory) {
    errors.push("memory section is required");
  } else {
    checkNumber(errors, "memory.max_entries", config.memory.max_entries, 100, 100000);
    checkNumber(errors, "memory.max_token_per_entry", config.memory.max_token_per_entry, 256, 4096);
    checkNumber(errors, "memory.max_categories", config.memory.max_categories, 10, 500);
    checkNumber(errors, "memory.max_subcategories_per_category", config.memory.max_subcategories_per_category, 10, 500);
    checkNumber(errors, "memory.max_subcategory_links", config.memory.max_subcategory_links, 1, 10);
    checkNumber(errors, "memory.max_subcategory_per_memory", config.memory.max_subcategory_per_memory, 1, 20);
  }

  // ── retrieval ───────────────────────────────────────────────────────
  if (!config.retrieval) {
    errors.push("retrieval section is required");
  } else {
    if (typeof config.retrieval.relevance_threshold !== "number" || config.retrieval.relevance_threshold < 0 || config.retrieval.relevance_threshold > 1) {
      errors.push("retrieval.relevance_threshold must be a number between 0 and 1");
    }
    checkNumber(errors, "retrieval.max_results", config.retrieval.max_results, 1, 10);
    if (typeof config.retrieval.timeout_ms !== "number" || config.retrieval.timeout_ms < 500) {
      errors.push("retrieval.timeout_ms must be a number >= 500");
    }
  }

  // ── ebbinghaus ──────────────────────────────────────────────────────
  if (!config.ebbinghaus) {
    errors.push("ebbinghaus section is required");
  } else {
    checkNumber(errors, "ebbinghaus.half_life_hours", config.ebbinghaus.half_life_hours, 1, 8760);
    if (typeof config.ebbinghaus.min_relevance !== "number" || config.ebbinghaus.min_relevance < 0 || config.ebbinghaus.min_relevance > 1) {
      errors.push("ebbinghaus.min_relevance must be a number between 0 and 1");
    }
    if (typeof config.ebbinghaus.reinforcement_boost !== "number" || config.ebbinghaus.reinforcement_boost < 0 || config.ebbinghaus.reinforcement_boost > 1) {
      errors.push("ebbinghaus.reinforcement_boost must be a number between 0 and 1");
    }
    checkNumber(errors, "ebbinghaus.prune_interval_hours", config.ebbinghaus.prune_interval_hours, 0.1, 168);
  }

  // ── summarization ───────────────────────────────────────────────────
  if (!config.summarization) {
    errors.push("summarization section is required");
  } else {
    if (typeof config.summarization.model !== "string") {
      errors.push("summarization.model must be a string");
    }
    if (typeof config.summarization.prompt_template !== "string") {
      errors.push("summarization.prompt_template must be a string");
    }
  }

  return errors;
}

function checkNumber(errors: string[], label: string, value: number, min: number, max: number): void {
  if (typeof value !== "number" || isNaN(value)) {
    errors.push(`${label} must be a number`);
  } else if (value < min || value > max) {
    errors.push(`${label} must be between ${min} and ${max} (got ${value})`);
  }
}

export function configToYaml(config: NeuroMemoryConfig): string {
  return yaml.dump(config as unknown as Record<string, unknown>, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: true,
  });
}
