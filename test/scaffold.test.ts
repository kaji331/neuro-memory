import { describe, it, expect } from "bun:test";
import { existsSync } from "fs";
import { resolve } from "path";

const root = resolve(import.meta.dir, "..");

describe("neuro-memory scaffold", () => {
  const requiredDirs = ["src", "scripts", "data", "test"];
  const requiredFiles = ["package.json", "tsconfig.json", "SKILL.md", "src/index.ts"];

  for (const dir of requiredDirs) {
    it(`should have directory: ${dir}`, () => {
      expect(existsSync(resolve(root, dir))).toBe(true);
    });
  }

  for (const file of requiredFiles) {
    it(`should have file: ${file}`, () => {
      expect(existsSync(resolve(root, file))).toBe(true);
    });
  }

  it("should export name and version from src/index.ts", async () => {
    const mod = await import(resolve(root, "src/index.ts"));
    expect(mod.name).toBe("neuro-memory");
    expect(mod.version).toBe("0.1.1");
  });
});
