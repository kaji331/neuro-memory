#!/usr/bin/env bun
/**
 * neuro-memory skill installer/updater — run via `bunx neuro-memory update`.
 *
 * Syncs the skill payload (SKILL.md, config, source) from this package into the
 * agent skills directory so agents pick up the latest version.
 *
 * Usage:
 *   neuro-memory update [--target <path>] [--force] [--dry-run]
 */

import { existsSync, mkdirSync, readdirSync, copyFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const PKG_NAME = "neuro-memory";
const DEFAULT_TARGET = join(homedir(), ".agents", "skills", "neuro-memory");

const SRC_FILES = ["SKILL.md", "README.md", "neuro-memory.yaml", "package.json", "tsconfig.json", "bun.lock"];
const SRC_DIRS = ["src", "test", "opencode-neuro-memory-plugin"];

const CRUSH_SRC = join("crush", "commands", "neuro-memory.md");
const CRUSH_DEST_DIR = join(homedir(), ".config", "crush", "commands");

const SKIP = new Set([".git", "node_modules", "data", ".sisyphus", "dist", "scripts"]);

function getArg(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  const v = i >= 0 ? args[i + 1] : undefined;
  return v && !v.startsWith("--") ? v : undefined;
}

function copyDir(src: string, dest: string, stats: { files: number }): void {
  let entries;
  try {
    entries = readdirSync(src, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    if (entry.isDirectory()) {
      copyDir(join(src, entry.name), join(dest, entry.name), stats);
    } else {
      mkdirSync(dest, { recursive: true });
      copyFileSync(join(src, entry.name), join(dest, entry.name));
      stats.files++;
    }
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const sub = args[0];

  if (sub !== "update" && sub !== "install") {
    console.log(`${PKG_NAME} skill updater`);
    console.log("Usage: neuro-memory update [--target <path>] [--force] [--dry-run]");
    if (sub && sub !== "--help" && sub !== "-h") {
      console.error(`Unknown subcommand: ${sub}`);
      process.exit(2);
    }
    return;
  }

  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");
  const target = resolve(getArg(args, "--target") ?? DEFAULT_TARGET);

  // Source = the directory that contains this script's package (grandparent of scripts/).
  const here = dirname(fileURLToPath(import.meta.url));
  const source = dirname(here);

  if (!existsSync(join(source, "SKILL.md"))) {
    console.error(`Cannot find SKILL.md in package root: ${source}`);
    process.exit(1);
  }

  if (!force && existsSync(target) && !existsSync(join(target, "data"))) {
    console.error(
      `Target exists but is missing data/ (safety check): ${target}\n` +
        `Refusing to overwrite an unknown directory. Use --force to proceed.`,
    );
    process.exit(1);
  }

  if (dryRun) {
    console.log(`[dry-run] Would sync:`);
    console.log(`  from: ${source}`);
    console.log(`  to:   ${target}`);
    console.log(`  files: ${SRC_FILES.join(", ")}`);
    console.log(`  dirs:  ${SRC_DIRS.join(", ")}`);
    console.log("  preserve: target/data/** (memory database is never overwritten)");
    const crushSrc = join(source, CRUSH_SRC);
    if (existsSync(crushSrc)) {
      console.log(`  crush command: ${crushSrc}`);
      console.log(`              -> ${join(CRUSH_DEST_DIR, "neuro-memory.md")}`);
    }
    return;
  }

  mkdirSync(target, { recursive: true });

  let count = 0;
  for (const f of SRC_FILES) {
    const fp = join(source, f);
    if (existsSync(fp)) {
      copyFileSync(fp, join(target, f));
      count++;
    }
  }
  const stats = { files: 0 };
  for (const d of SRC_DIRS) {
    copyDir(join(source, d), join(target, d), stats);
  }

  // Sync the crush custom command, but never clobber an existing user file.
  const crushSrc = join(source, CRUSH_SRC);
  const crushDest = join(CRUSH_DEST_DIR, "neuro-memory.md");
  if (existsSync(crushSrc)) {
    if (existsSync(crushDest)) {
      console.log(`Note: crush command already exists, leaving untouched: ${crushDest}`);
    } else {
      mkdirSync(CRUSH_DEST_DIR, { recursive: true });
      copyFileSync(crushSrc, crushDest);
      console.log(`Copied crush command -> ${crushDest}`);
    }
  }

  console.log(`Updated ${PKG_NAME} skill -> ${target}`);
  console.log(`Copied ${count + stats.files} files. Existing data/ (memory database) preserved.`);
  console.log("Restart your agent session to pick up the new SKILL.md.");
}

main();
