import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";

// We import the module dynamically after environment setup where needed
import {
  getDefaultConfig,
  validateConfig,
  configToYaml,
  type NeuroMemoryConfig,
} from "../src/config";

// ── Helpers ─────────────────────────────────────────────────────────────────

function validConfig(): NeuroMemoryConfig {
  return getDefaultConfig();
}

const TMP_DIR = resolve(tmpdir(), "neuro-memory-config-test");

function tmpPath(name: string): string {
  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
  return resolve(TMP_DIR, name);
}

function writeYaml(name: string, content: string): string {
  const p = tmpPath(name);
  writeFileSync(p, content, "utf-8");
  return p;
}

function cleanup(name: string): void {
  const p = tmpPath(name);
  if (existsSync(p)) unlinkSync(p);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("getDefaultConfig", () => {
  it("returns all sections with correct defaults", () => {
    const cfg = getDefaultConfig();

    expect(cfg.db.type).toBe("sqlite");
    expect(cfg.db.sqlite_path).toBe("~/.agents/skills/neuro-memory/data/memory.db");
    expect(cfg.db.postgres_url).toBeUndefined();

    expect(cfg.memory.max_entries).toBe(5000);
    expect(cfg.memory.max_token_per_entry).toBe(1024);
    expect(cfg.memory.max_categories).toBe(50);
    expect(cfg.memory.max_subcategories_per_category).toBe(100);
    expect(cfg.memory.max_subcategory_links).toBe(3);
    expect(cfg.memory.max_subcategory_per_memory).toBe(10);

    expect(cfg.retrieval.relevance_threshold).toBe(0.75);
    expect(cfg.retrieval.max_results).toBe(3);
    expect(cfg.retrieval.timeout_ms).toBe(3000);

    expect(cfg.ebbinghaus.half_life_hours).toBe(24);
    expect(cfg.ebbinghaus.min_relevance).toBe(0.1);
    expect(cfg.ebbinghaus.reinforcement_boost).toBe(0.15);
    expect(cfg.ebbinghaus.prune_interval_hours).toBe(1);

    expect(cfg.summarization.model).toBe("");
    expect(cfg.summarization.prompt_template).toBe("");

    expect(cfg.silent).toBe(true);
  });

  it("returns a deep copy, not a shared reference", () => {
    const a = getDefaultConfig();
    const b = getDefaultConfig();
    a.memory.max_entries = 9999;
    expect(b.memory.max_entries).toBe(5000);
  });
});

describe("validateConfig", () => {
  it("returns empty array for valid default config", () => {
    const errors = validateConfig(validConfig());
    expect(errors).toEqual([]);
  });

  it("detects invalid db.type", () => {
    const cfg = validConfig();
    cfg.db.type = "mongodb" as any;
    const errors = validateConfig(cfg);
    expect(errors.some((e) => e.includes("db.type"))).toBe(true);
  });

  it("detects empty sqlite_path", () => {
    const cfg = validConfig();
    cfg.db.sqlite_path = "";
    const errors = validateConfig(cfg);
    expect(errors.some((e) => e.includes("sqlite_path"))).toBe(true);
  });

  it("detects out-of-range relevance_threshold", () => {
    const cfg = validConfig();
    cfg.retrieval.relevance_threshold = 2.0;
    const errors = validateConfig(cfg);
    expect(errors.some((e) => e.includes("relevance_threshold"))).toBe(true);
  });

  it("detects negative relevance_threshold", () => {
    const cfg = validConfig();
    cfg.retrieval.relevance_threshold = -0.5;
    const errors = validateConfig(cfg);
    expect(errors.some((e) => e.includes("relevance_threshold"))).toBe(true);
  });

  it("detects timeout_ms < 500", () => {
    const cfg = validConfig();
    cfg.retrieval.timeout_ms = 100;
    const errors = validateConfig(cfg);
    expect(errors.some((e) => e.includes("timeout_ms"))).toBe(true);
  });

  it("detects half_life_hours > 8760", () => {
    const cfg = validConfig();
    cfg.ebbinghaus.half_life_hours = 10000;
    const errors = validateConfig(cfg);
    expect(errors.some((e) => e.includes("half_life_hours"))).toBe(true);
  });

  it("detects max_entries below minimum", () => {
    const cfg = validConfig();
    cfg.memory.max_entries = 50;
    const errors = validateConfig(cfg);
    expect(errors.some((e) => e.includes("max_entries"))).toBe(true);
  });

  it("detects NaN values", () => {
    const cfg = validConfig();
    cfg.memory.max_entries = NaN;
    const errors = validateConfig(cfg);
    expect(errors.some((e) => e.includes("max_entries"))).toBe(true);
  });

  it("detects missing db section", () => {
    const cfg = validConfig();
    delete (cfg as any).db;
    const errors = validateConfig(cfg);
    expect(errors.some((e) => e.includes("db section"))).toBe(true);
  });

  it("detects non-boolean silent", () => {
    const cfg = validConfig();
    (cfg as any).silent = "yes";
    const errors = validateConfig(cfg);
    expect(errors.some((e) => e.includes("silent"))).toBe(true);
  });
});

describe("loadConfig", () => {
  const testFiles: string[] = [];

  beforeEach(() => {
    // Ensure clean env for each test
    delete process.env.CLAUDE_SKILL_DIR;
  });

  afterEach(() => {
    for (const f of testFiles) cleanup(f);
    testFiles.length = 0;
  });

  it("returns defaults when no config file exists", async () => {
    const { loadConfig } = await import("../src/config");
    const cfg = loadConfig("/nonexistent/path/neuro-memory.yaml");
    expect(cfg.db.type).toBe("sqlite");
    expect(cfg.memory.max_entries).toBe(5000);
  });

  it("merges partial YAML config with defaults", async () => {
    const { loadConfig } = await import("../src/config");
    const p = writeYaml("partial.yaml", `
db:
  type: postgres
  sqlite_path: /custom/memory.db
memory:
  max_entries: 1000
`);
    testFiles.push("partial.yaml");

    const cfg = loadConfig(p);
    expect(cfg.db.type).toBe("postgres");
    expect(cfg.db.sqlite_path).toBe("/custom/memory.db");
    expect(cfg.memory.max_entries).toBe(1000);
    // Check defaults preserved
    expect(cfg.memory.max_token_per_entry).toBe(1024);
    expect(cfg.retrieval.relevance_threshold).toBe(0.75);
    expect(cfg.ebbinghaus.half_life_hours).toBe(24);
  });

  it("throws on invalid YAML", async () => {
    const { loadConfig } = await import("../src/config");
    const p = writeYaml("invalid.yaml", "key: [unclosed list");
    testFiles.push("invalid.yaml");

    expect(() => loadConfig(p)).toThrow(/Invalid YAML/);
  });

  it("throws on out-of-range value in config file", async () => {
    const { loadConfig } = await import("../src/config");
    const p = writeYaml("oor.yaml", `
retrieval:
  relevance_threshold: 2.0
`);
    testFiles.push("oor.yaml");

    expect(() => loadConfig(p)).toThrow(/Config validation failed/);
  });

  it("throws on non-object YAML", async () => {
    const { loadConfig } = await import("../src/config");
    const p = writeYaml("scalar.yaml", "just a string");
    testFiles.push("scalar.yaml");

    expect(() => loadConfig(p)).toThrow(/YAML mapping/);
  });

  it("expands tilde in sqlite_path", async () => {
    const { loadConfig } = await import("../src/config");
    const p = writeYaml("tilde.yaml", `
db:
  sqlite_path: ~/custom/memory.db
`);
    testFiles.push("tilde.yaml");

    const cfg = loadConfig(p);
    expect(cfg.db.sqlite_path).toContain("/home/");
    expect(cfg.db.sqlite_path).not.toContain("~/");
    expect(cfg.db.sqlite_path).toEndWith("/custom/memory.db");
  });

  it("uses CLAUDE_SKILL_DIR env var to find config", async () => {
    const { loadConfig } = await import("../src/config");
    const customDir = tmpPath("skill-dir");
    if (!existsSync(customDir)) mkdirSync(customDir, { recursive: true });

    const configPath = resolve(customDir, "neuro-memory.yaml");
    writeFileSync(configPath, `
memory:
  max_entries: 777
`, "utf-8");

    process.env.CLAUDE_SKILL_DIR = customDir;

    const cfg = loadConfig();
    expect(cfg.memory.max_entries).toBe(777);
    testFiles.push(configPath);
  });
});

describe("configToYaml", () => {
  it("round-trips back to valid config", () => {
    const cfg = getDefaultConfig();
    const yaml = configToYaml(cfg);
    expect(yaml).toBeTruthy();
    expect(yaml).toContain("sqlite");
    expect(yaml).toContain("5000");
    expect(yaml).toContain("0.75");
  });
});
