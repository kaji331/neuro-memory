import yaml from "js-yaml";
import { existsSync, readFileSync } from "fs";
import { resolve, sep } from "path";
import { homedir } from "os";

export interface PluginConfig {
  display: boolean;
  dbPath: string;
}

const BASE_DIR = resolve(homedir(), ".config", "opencode", "neuro-memory");
const DEFAULT_DB_FILE = "memory.db";

function skillFallbackDir(): string {
  const override = process.env.NEURO_MEMORY_SKILL_DIR;
  if (override) return override;
  return resolve(homedir(), ".agents", "skills", "neuro-memory");
}

function resolveConfigPath(directory: string): string | null {
  const projectPath = resolve(directory, "neuro-memory.yaml");
  if (existsSync(projectPath)) return projectPath;

  const fallbackPath = resolve(skillFallbackDir(), "neuro-memory.yaml");
  if (existsSync(fallbackPath)) return fallbackPath;

  return null;
}

function resolveDbPath(raw: unknown): string {
  const base = BASE_DIR;
  if (raw === undefined || raw === null || raw === "") {
    return resolve(base, DEFAULT_DB_FILE);
  }
  if (typeof raw !== "string") {
    throw new Error(`db.memory_db_path must be a string (got ${typeof raw})`);
  }

  const candidate = resolve(base, raw);
  if (!candidate.startsWith(base + sep) && candidate !== base) {
    throw new Error(
      `db.memory_db_path "${raw}" escapes the allowed base directory "${base}" (path traversal blocked)`,
    );
  }
  return candidate;
}

function resolveDisplay(raw: Record<string, unknown>): boolean {
  const display = raw.display;
  const silent = raw.silent;

  if (typeof display === "boolean") return display;
  if (typeof silent === "boolean") return !silent;
  return false;
}

export function loadPluginConfig(directory: string): PluginConfig {
  const configPath = resolveConfigPath(directory);

  if (!configPath) {
    return { display: false, dbPath: resolveDbPath(undefined) };
  }

  let rawStr: string;
  try {
    rawStr = readFileSync(configPath, "utf-8");
  } catch (err) {
    throw new Error(`Cannot read config file at "${configPath}": ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(rawStr);
  } catch (err) {
    throw new Error(`Invalid YAML in config file "${configPath}": ${(err as Error).message}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Config file "${configPath}" must contain a YAML mapping (object)`);
  }

  const root = parsed as Record<string, unknown>;
  const db = (root.db ?? {}) as Record<string, unknown>;

  return {
    display: resolveDisplay(root),
    dbPath: resolveDbPath(db.memory_db_path),
  };
}
