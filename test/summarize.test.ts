import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  truncateToTokenBudget,
  summarizeTurn,
} from "../src/summarize";
import { createAdapter, type DBAdapter } from "../src/db/adapter";
import { getDefaultConfig } from "../src/config";
import { computeContentHash } from "../src/hash";
import type { NeuroMemoryConfig } from "../src/config";

// ── Test adapter factory ──────────────────────────────────────────────────────

function createTestAdapter(config?: Partial<NeuroMemoryConfig>): { adapter: DBAdapter; config: NeuroMemoryConfig } {
  const baseConfig = getDefaultConfig();
  const testConfig: NeuroMemoryConfig = {
    ...baseConfig,
    ...config,
    db: { ...baseConfig.db, ...(config?.db || {}), sqlite_path: ":memory:" },
    memory: { ...baseConfig.memory, ...(config?.memory || {}) },
    retrieval: { ...baseConfig.retrieval, ...(config?.retrieval || {}) },
    ebbinghaus: { ...baseConfig.ebbinghaus, ...(config?.ebbinghaus || {}) },
    summarization: { ...baseConfig.summarization, ...(config?.summarization || {}) },
  };

  const adapter = createAdapter(testConfig);
  return { adapter, config: testConfig };
}

// ── truncateToTokenBudget ─────────────────────────────────────────────────────

describe("truncateToTokenBudget", () => {
  it("returns text as-is when under budget", () => {
    const text = "Hello world, this is a short message.";
    const result = truncateToTokenBudget(text, 200);
    expect(result).toBe(text);
  });

  it("returns text as-is when exactly at budget", () => {
    // 40 chars = ~10 tokens, budget of 10
    const text = "1234567890123456789012345678901234567890"; // 40 chars
    const result = truncateToTokenBudget(text, 10);
    expect(result).toBe(text);
  });

  it("truncates from the middle when over budget", () => {
    const head = "=== BEGINNING CONTEXT ===\n" + "A".repeat(500) + "\n";
    const middle = "X".repeat(8000) + "\n";
    const tail = "Z".repeat(500) + "\n=== END CONTEXT ===";

    const text = head + middle + tail;
    const result = truncateToTokenBudget(text, 500);

    expect(result.length).toBeLessThanOrEqual(500 * 4);
    expect(result).toContain("=== BEGINNING CONTEXT ===");
    expect(result).toContain("=== END CONTEXT ===");
    expect(result).toContain("[truncated");

    // Head content starts before any middle pollution
    const headIdx = result.indexOf("=== BEGINNING CONTEXT ===");
    const truncIdx = result.indexOf("[truncated");
    const endIdx = result.indexOf("=== END CONTEXT ===");
    expect(headIdx).toBeLessThan(truncIdx);
    expect(truncIdx).toBeLessThan(endIdx);
  });

  it("handles 15k character input → resolves to <= 8k tokens", () => {
    // 15k chars = ~3750 tokens, budget of 8000 tokens is huge, so no truncation needed
    const text = "X".repeat(15000);
    const result = truncateToTokenBudget(text, 8000);
    expect(result).toBe(text);
    expect(result.length).toBe(15000);
  });

  it("handles 15k tokens input → truncates to <= 8000 tokens", () => {
    // 15k tokens = ~60k chars
    const head = "=== HEAD ===\n" + "A".repeat(10000) + "\n";
    const middle = "B".repeat(45000) + "\n";
    const tail = "C".repeat(10000) + "\n=== TAIL ===";

    const text = head + middle + tail; // ~65k chars > 8000 tokens * 4 = 32000 chars
    const result = truncateToTokenBudget(text, 8000);

    // Should be within budget (8000 tokens * 4 chars/token)
    expect(result.length).toBeLessThanOrEqual(8000 * 4);

    // Should preserve head (first ~500 tokens ≈ 2000 chars)
    expect(result).toContain("=== HEAD ===");

    // Should preserve tail portion
    expect(result).toContain("=== TAIL ===");

    // Should contain truncation marker
    expect(result).toContain("... [truncated"); // ellipsis marker between head and tail
  });

  it("preserves first ~500 tokens of content", () => {
    // 500 tokens ≈ 2000 chars
    const head = "=== HEAD ===\n" + "A".repeat(1900) + "\n";
    const middle = "B".repeat(20000) + "\n";
    const tail = "C".repeat(500) + "\n=== TAIL ===";
    const text = head + middle + tail;

    const result = truncateToTokenBudget(text, 500);

    // Should preserve most/all of the head section
    expect(result).toContain("=== HEAD ===");
    expect(result.startsWith("=== HEAD ===")).toBe(true);
  });

  it("returns original text for empty string", () => {
    expect(truncateToTokenBudget("", 100)).toBe("");
  });

  it("handles text shorter than head budget", () => {
    const text = "Short text that is under the token budget limit";
    const result = truncateToTokenBudget(text, 100);
    expect(result).toBe(text); // 46 chars < 100 tokens * 4 = 400 chars → no truncation
  });
});

// ── summarizeTurn ─────────────────────────────────────────────────────────────

describe("summarizeTurn", () => {
  let db: DBAdapter;
  let config: NeuroMemoryConfig;

  beforeAll(async () => {
    const t = createTestAdapter();
    db = t.adapter;
    config = t.config;
    await db.init(config);
  });

  afterAll(async () => {
    await db.close();
  });

  it("returns should_store=false for content below 200 chars", async () => {
    const result = await summarizeTurn(db, config, {
      turn: "Hello world",
    });

    expect(result.should_store).toBe(false);
    expect(result.summary).toBe("");
  });

  it("returns should_store=false for greeting-like content", async () => {
    const result = await summarizeTurn(db, config, {
      turn: "User: hello\nAssistant: Hi! How can I help you today?",
    });

    expect(result.should_store).toBe(false);
  });

  it("returns should_store=false for empty input", async () => {
    const result = await summarizeTurn(db, config, {
      turn: "",
    });

    expect(result.should_store).toBe(false);
    expect(result.summary).toBe("");
  });

  it("produces classification for substantial content", async () => {
    // Content >= 200 chars with real substance
    const turn = "User: What is a closure in JavaScript?\nAssistant: A closure is a function that retains access to its lexical scope, even when the function is executed outside that scope. Closures are created every time a function is created in JavaScript, at function creation time. They are commonly used for data privacy, callback functions, and module patterns.";

    const result = await summarizeTurn(db, config, {
      turn,
      maxTokens: 8000,
    });

    // Basic shape validation
    expect(result).toHaveProperty("should_store");
    expect(result).toHaveProperty("summary");
    expect(result).toHaveProperty("relevance");
    expect(result).toHaveProperty("categories");

    if (result.should_store) {
      expect(result.summary.length).toBeGreaterThan(0);
      expect(result.relevance).toBeGreaterThanOrEqual(0);
      expect(result.relevance).toBeLessThanOrEqual(1);
      expect(Array.isArray(result.categories)).toBe(true);
    }
  });

  it("output has correct JSON-serializable shape", async () => {
    const turn = "User: Explain TypeScript interfaces.\nAssistant: TypeScript interfaces define the shape of an object. They can describe properties, methods, and index signatures. Interfaces support declaration merging, can extend other interfaces, and are purely a compile-time construct.";

    const result = await summarizeTurn(db, config, { turn });

    // Verify all expected keys exist
    const keys = Object.keys(result).sort();
    expect(keys).toContain("should_store");
    expect(keys).toContain("summary");
    expect(keys).toContain("relevance");
    expect(keys).toContain("categories");

    // Verify types
    expect(typeof result.should_store).toBe("boolean");
    expect(typeof result.summary).toBe("string");
    expect(typeof result.relevance).toBe("number");
    expect(Array.isArray(result.categories)).toBe(true);

    // Verify JSON serialization round-trip
    const json = JSON.stringify(result);
    const parsed = JSON.parse(json);
    expect(parsed.should_store).toBe(result.should_store);
    expect(parsed.summary).toBe(result.summary);
    expect(parsed.relevance).toBe(result.relevance);
  });

  it("stores memory when should_store=true", async () => {
    // Use unique content to avoid dedup conflicts
    const uniqueId = Date.now().toString(36);
    const turn = `User: What is the ${uniqueId} encryption algorithm?\nAssistant: The ${uniqueId} algorithm is a symmetric block cipher that operates on 128-bit blocks with a 256-bit key. It was designed for high security in embedded systems and IoT devices. It uses 14 rounds of substitution and permutation with a custom S-box derived from the golden ratio.`;

    const result = await summarizeTurn(db, config, { turn });

    expect(result).toHaveProperty("stored");

    if (result.should_store) {
      expect(result.stored).toBeDefined();
      expect(result.stored).toHaveProperty("id");
      expect(result.stored).toHaveProperty("created");
      expect(result.stored).toHaveProperty("reinforced");
      expect(typeof result.stored!.id).toBe("number");
    }
  });

  it("dedup: second insert of same content reinforces instead of creating duplicate", async () => {
    const uniqueId = Date.now().toString(36);
    const turn = `User: Tell me about the ${uniqueId} protocol for network communication.\nAssistant: The ${uniqueId} protocol is a transport-layer protocol designed for low-latency communication over unreliable networks. It uses forward error correction and adaptive rate control. It was standardized in 2024 by the IETF.`;

    // First insert
    const result1 = await summarizeTurn(db, config, { turn });

    if (result1.should_store) {
      expect(result1.stored).toBeDefined();
      expect(result1.stored!.created).toBe(true);

      // Second insert — same content → should reinforce
      const result2 = await summarizeTurn(db, config, { turn });

      // should_store might be false due to classifier variation,
      // but if it's true, it should be a reinforce, not new insertion
      if (result2.should_store) {
        expect(result2.stored!.created).toBe(false);
        expect(result2.stored!.reinforced).toBe(true);
      }
    }
  });

  it("respects maxTokens option for truncation", async () => {
    const turn = "User: Tell me about " + "the history of computer science ".repeat(100) + "\nAssistant: " + "Computer science is the study of computation and information. ".repeat(100);

    const result = await summarizeTurn(db, config, {
      turn,
      maxTokens: 500,
    });

    // Should still produce valid output even with heavy truncation
    expect(result).toHaveProperty("should_store");
    expect(result).toHaveProperty("summary");
  });

  it("handles whitespace-only turn", async () => {
    const result = await summarizeTurn(db, config, {
      turn: "   \n  \t  ",
    });

    expect(result.should_store).toBe(false);
  });

  it("categories array has correct structure when should_store=true", async () => {
    const turn = "User: What is Rust's borrow checker?\nAssistant: Rust's borrow checker is a compile-time mechanism that enforces memory safety rules: each value has exactly one owner, and references must not outlive the data they point to. It prevents data races, use-after-free, and double-free bugs without a garbage collector. The borrow checker tracks lifetimes and ensures that mutable references are exclusive.";

    const result = await summarizeTurn(db, config, { turn });

    if (result.should_store && result.categories.length > 0) {
      for (const cat of result.categories) {
        expect(cat).toHaveProperty("category");
        expect(cat).toHaveProperty("subcategory");
        expect(cat).toHaveProperty("confidence");
        expect(typeof cat.category).toBe("string");
        expect(typeof cat.subcategory).toBe("string");
        expect(typeof cat.confidence).toBe("number");
        expect(cat.confidence).toBeGreaterThanOrEqual(0);
        expect(cat.confidence).toBeLessThanOrEqual(1);
      }
    }
  });
});
