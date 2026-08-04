import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, unlinkSync, existsSync, mkdirSync, rmSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";

import { loadPluginConfig } from "../../plugin/config";

// ── Helpers ─────────────────────────────────────────────────────────────────

const TMP_DIR = resolve(tmpdir(), "neuro-memory-plugin-config-test");

function tmpPath(...parts: string[]): string {
  return resolve(TMP_DIR, ...parts);
}

/** Create a directory (and parents) if needed, return its path. */
function ensureDir(dir: string): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** Write a neuro-memory.yaml into `dir`; return the dir. */
function writeConfig(dir: string, content: string): string {
  ensureDir(dir);
  writeFileSync(resolve(dir, "neuro-memory.yaml"), content, "utf-8");
  return dir;
}

// Remember which env var we must restore.
const FALLBACK_ENV = "NEURO_MEMORY_SKILL_DIR";
const savedFallback = process.env[FALLBACK_ENV];

// ── Tests ───────────────────────────────────────────────────────────────────

describe("loadPluginConfig", () => {
  beforeEach(() => {
    // Isolated per-test trees, cleared before each test.
    rmSync(TMP_DIR, { recursive: true, force: true });
    ensureDir(TMP_DIR);
    // Point fallback skill dir at an empty temp dir so tests never depend on the
    // real ~/.agents/skills/neuro-memory state on the machine running tests.
    process.env[FALLBACK_ENV] = ensureDir(tmpPath("fallback"));
  });

  afterEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true });
    if (savedFallback === undefined) delete process.env[FALLBACK_ENV];
    else process.env[FALLBACK_ENV] = savedFallback;
  });

  const emptyProject = () => ensureDir(tmpPath("project-empty"));

  it("defaults to display=false and a resolved dbPath when no config file exists", () => {
    const cfg = loadPluginConfig(emptyProject());
    expect(cfg.display).toBe(false);
    expect(typeof cfg.dbPath).toBe("string");
    expect(cfg.dbPath.length).toBeGreaterThan(0);
    expect(cfg.dbPath).toContain("memory.db");
  });

  it("detects display:true and returns configured memory_db_path", () => {
    const dir = writeConfig(
      tmpPath("project-display-true"),
      "display: true\ndb:\n  memory_db_path: shared.db\n",
    );
    const cfg = loadPluginConfig(dir);
    expect(cfg.display).toBe(true);
  });

  it("treats display:false as silent (default behaviour)", () => {
    const dir = writeConfig(tmpPath("project-display-false"), "display: false\n");
    expect(loadPluginConfig(dir).display).toBe(false);
  });

  it("defaults to silent when a config file exists but omits display", () => {
    const dir = writeConfig(tmpPath("project-no-display"), "summarization:\n  model: llama\n");
    expect(loadPluginConfig(dir).display).toBe(false);
  });

  it("maps legacy silent:false to display:true for back-compat", () => {
    const dir = writeConfig(tmpPath("project-silent-false"), "silent: false\n");
    expect(loadPluginConfig(dir).display).toBe(true);
  });

  it("maps legacy silent:true to display:false for back-compat", () => {
    const dir = writeConfig(tmpPath("project-silent-true"), "silent: true\n");
    expect(loadPluginConfig(dir).display).toBe(false);
  });

  it("lets the new display field win over a legacy silent key", () => {
    const dir = writeConfig(
      tmpPath("project-display-wins"),
      "silent: true\ndisplay: true\n",
    );
    expect(loadPluginConfig(dir).display).toBe(true);
  });

  it("resolves a relative memory_db_path inside the allowed base directory", () => {
    const dir = writeConfig(
      tmpPath("project-rel"),
      "db:\n  memory_db_path: shared/mem.db\n",
    );
    const cfg = loadPluginConfig(dir);
    // Must land inside the base dir (…/opencode/neuro-memory/), not project cwd.
    expect(cfg.dbPath).toContain("neuro-memory");
    expect(cfg.dbPath.endsWith("shared/mem.db")).toBe(true);
  });

  it("rejects memory_db_path that escapes the base directory (traversal)", () => {
    const dir = writeConfig(
      tmpPath("project-traversal"),
      "db:\n  memory_db_path: ../../secrets.db\n",
    );
    expect(() => loadPluginConfig(dir)).toThrow();
  });

  it("returns defaults when only an unrelated project config file exists", () => {
    // A config with no display and no db override → fully default.
    const dir = writeConfig(
      tmpPath("project-defaults"),
      "memory:\n  max_entries: 1000\n",
    );
    const cfg = loadPluginConfig(dir);
    expect(cfg.display).toBe(false);
    expect(cfg.dbPath).toContain("memory.db");
  });
});
