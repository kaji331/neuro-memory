import { describe, it, expect } from "bun:test";
import { DuckDBAdapter } from "../../src/db/duckdb-adapter";
import { MySQLAdapter } from "../../src/db/mysql-adapter";
import { MariaDBAdapter } from "../../src/db/mariadb-adapter";
import type { NeuroMemoryConfig } from "../../src/config";

function makeConfig(type: string): NeuroMemoryConfig {
  return {
    db: { type } as any,
    categoryCount: 10,
    subcategoryCount: 10,
    memoryCount: 1000,
    halfLifeHours: 24,
    reinforcementBoost: 0.1,
    minRelevanceThreshold: 0.01,
    maintenanceIntervalMs: 3600000,
  };
}

describe("DuckDBAdapter stub", () => {
  it("throws not implemented on init()", () => {
    const adapter = new DuckDBAdapter(makeConfig("duckdb"));
    expect(() => adapter.init(makeConfig("duckdb"))).toThrow("DuckDB adapter not implemented");
  });

  it("throws not implemented on close()", () => {
    const adapter = new DuckDBAdapter(makeConfig("duckdb"));
    expect(() => adapter.close()).toThrow("DuckDB adapter not implemented");
  });

  it("throws not implemented on createCategory()", () => {
    const adapter = new DuckDBAdapter(makeConfig("duckdb"));
    expect(() => adapter.createCategory("test")).toThrow("DuckDB adapter not implemented");
  });

  it("throws not implemented on getAllCategories()", () => {
    const adapter = new DuckDBAdapter(makeConfig("duckdb"));
    expect(() => adapter.getAllCategories()).toThrow("DuckDB adapter not implemented");
  });

  it("throws not implemented on insertMemory()", () => {
    const adapter = new DuckDBAdapter(makeConfig("duckdb"));
    expect(() => adapter.insertMemory({ content: "x", summary: "x", contentHash: "x", relevance: 1, subcategoryId: 1 })).toThrow("DuckDB adapter not implemented");
  });

  it("throws not implemented on runMaintenance()", () => {
    const adapter = new DuckDBAdapter(makeConfig("duckdb"));
    expect(() => adapter.runMaintenance(24, 0.1, 0.01)).toThrow("DuckDB adapter not implemented");
  });
});

describe("MySQLAdapter stub", () => {
  it("throws not implemented on init()", () => {
    const adapter = new MySQLAdapter(makeConfig("mysql"));
    expect(() => adapter.init(makeConfig("mysql"))).toThrow("MySQL adapter not implemented");
  });

  it("throws not implemented on close()", () => {
    const adapter = new MySQLAdapter(makeConfig("mysql"));
    expect(() => adapter.close()).toThrow("MySQL adapter not implemented");
  });

  it("throws not implemented on searchMemories()", () => {
    const adapter = new MySQLAdapter(makeConfig("mysql"));
    expect(() => adapter.searchMemories({ keyword: "test" })).toThrow("MySQL adapter not implemented");
  });

  it("throws not implemented on getMemoryCount()", () => {
    const adapter = new MySQLAdapter(makeConfig("mysql"));
    expect(() => adapter.getMemoryCount()).toThrow("MySQL adapter not implemented");
  });

  it("throws not implemented on runMaintenance()", () => {
    const adapter = new MySQLAdapter(makeConfig("mysql"));
    expect(() => adapter.runMaintenance(24, 0.1, 0.01)).toThrow("MySQL adapter not implemented");
  });
});

describe("MariaDBAdapter stub", () => {
  it("throws not implemented on init()", () => {
    const adapter = new MariaDBAdapter(makeConfig("mariadb"));
    expect(() => adapter.init(makeConfig("mariadb"))).toThrow("MariaDB adapter not implemented");
  });

  it("throws not implemented on close()", () => {
    const adapter = new MariaDBAdapter(makeConfig("mariadb"));
    expect(() => adapter.close()).toThrow("MariaDB adapter not implemented");
  });

  it("throws not implemented on deleteCategory()", () => {
    const adapter = new MariaDBAdapter(makeConfig("mariadb"));
    expect(() => adapter.deleteCategory(1)).toThrow("MariaDB adapter not implemented");
  });

  it("throws not implemented on deleteMemory()", () => {
    const adapter = new MariaDBAdapter(makeConfig("mariadb"));
    expect(() => adapter.deleteMemory(1)).toThrow("MariaDB adapter not implemented");
  });

  it("throws not implemented on runMaintenance()", () => {
    const adapter = new MariaDBAdapter(makeConfig("mariadb"));
    expect(() => adapter.runMaintenance(24, 0.1, 0.01)).toThrow("MariaDB adapter not implemented");
  });
});
