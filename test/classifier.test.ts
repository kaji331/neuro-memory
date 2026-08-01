import { describe, it, expect } from "bun:test";
import {
  buildClassificationPrompt,
  parseClassificationOutput,
  validateClassificationResult,
  quickShouldStore,
  estimateTokens,
  formatCategoriesForDisplay,
  checkCategorySimilarity,
  type ClassificationResult,
  type ClassificationCategory,
} from "../src/classifier";

// ── Helpers ─────────────────────────────────────────────────────────────────

function validResult(): ClassificationResult {
  return {
    summary: "Python list comprehensions provide concise syntax for creating lists from iterables.",
    relevance: 0.85,
    categories: [
      { category: "Programming", subcategory: "Python", confidence: 0.95 },
    ],
    should_store: true,
  };
}

// ── buildClassificationPrompt ───────────────────────────────────────────────

describe("buildClassificationPrompt", () => {
  it("includes existing categories in output", () => {
    const prompt = buildClassificationPrompt(
      "User: What is Python?\nAgent: Python is a programming language.",
      ["Programming", "AI"],
    );

    expect(prompt).toContain('"Programming"');
    expect(prompt).toContain('"AI"');
  });

  it("handles empty categories list", () => {
    const prompt = buildClassificationPrompt(
      "User: What is Python?",
      [],
    );

    expect(prompt).toContain("no existing categories yet");
  });

  it("includes the conversation turn text", () => {
    const turn = "User: Tell me about Rust.\nAgent: Rust is a systems programming language.";
    const prompt = buildClassificationPrompt(turn, ["Programming"]);

    expect(prompt).toContain(turn);
  });

  it("respects maxTokenPerEntry option", () => {
    const prompt = buildClassificationPrompt(
      "test turn",
      [],
      { maxTokenPerEntry: 512 },
    );

    expect(prompt).toContain("512 tokens");
    expect(prompt).toContain("2048 characters"); // 512 * 4
  });

  it("respects maxSubcategoryPerMemory option", () => {
    const prompt = buildClassificationPrompt(
      "test turn",
      [],
      { maxSubcategoryPerMemory: 5 },
    );

    expect(prompt).toContain("up to 5 subcategories");
  });

  it("uses defaults when no options provided", () => {
    const prompt = buildClassificationPrompt("test", []);

    // Default maxTokenPerEntry = 1024
    expect(prompt).toContain("1024 tokens");
    // Default maxSubcategoryPerMemory = 10
    expect(prompt).toContain("up to 10 subcategories");
  });

  it("includes the JSON schema example", () => {
    const prompt = buildClassificationPrompt("test", []);

    expect(prompt).toContain('"summary"');
    expect(prompt).toContain('"relevance"');
    expect(prompt).toContain('"categories"');
    expect(prompt).toContain('"should_store"');
  });

  it("includes guardrail instructions", () => {
    const prompt = buildClassificationPrompt("test", []);

    expect(prompt).toContain("should_store=false");
    expect(prompt).toContain("must be self-contained");
    expect(prompt).toContain("Prefer existing categories");
    expect(prompt).toContain("Return ONLY valid JSON");
  });
});

// ── parseClassificationOutput ────────────────────────────────────────────────

describe("parseClassificationOutput", () => {
  it("parses valid JSON correctly", () => {
    const json = JSON.stringify({
      summary: "Python is a high-level programming language.",
      relevance: 0.9,
      categories: [
        { category: "Programming", subcategory: "Python", confidence: 0.95 },
      ],
      should_store: true,
    });

    const { result, errors } = parseClassificationOutput(json);

    expect(errors).toEqual([]);
    expect(result).not.toBeNull();
    expect(result!.summary).toBe("Python is a high-level programming language.");
    expect(result!.relevance).toBe(0.9);
    expect(result!.categories).toHaveLength(1);
    expect(result!.categories[0].category).toBe("Programming");
    expect(result!.categories[0].subcategory).toBe("Python");
    expect(result!.categories[0].confidence).toBe(0.95);
    expect(result!.should_store).toBe(true);
  });

  it("strips markdown fences before parsing", () => {
    const raw = '```json\n{"summary":"Test","relevance":0.5,"categories":[{"category":"A","subcategory":"B","confidence":0.8}],"should_store":true}\n```';

    const { result, errors } = parseClassificationOutput(raw);

    expect(errors).toEqual([]);
    expect(result).not.toBeNull();
    expect(result!.summary).toBe("Test");
    expect(result!.relevance).toBe(0.5);
  });

  it("handles markdown fences without language tag", () => {
    const raw = '```\n{"summary":"Test","relevance":0.5,"categories":[],"should_store":false}\n```';

    const { result, errors } = parseClassificationOutput(raw);

    expect(errors).toEqual([]);
    expect(result).not.toBeNull();
    expect(result!.summary).toBe("Test");
    expect(result!.should_store).toBe(false);
  });

  it("handles leading/trailing whitespace", () => {
    const raw = '   \n  {"summary":"Test","relevance":0.5,"categories":[],"should_store":false}  \n  ';

    const { result, errors } = parseClassificationOutput(raw);

    expect(errors).toEqual([]);
    expect(result).not.toBeNull();
    expect(result!.summary).toBe("Test");
  });

  it("returns errors for malformed JSON, does not crash", () => {
    const raw = "{ not valid json at all }";

    const { result, errors } = parseClassificationOutput(raw);

    expect(result).toBeNull();
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("JSON parse error");
  });

  it("returns errors for empty string", () => {
    const { result, errors } = parseClassificationOutput("");

    expect(result).toBeNull();
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("Empty");
  });

  it("returns errors for non-object JSON", () => {
    const { result, errors } = parseClassificationOutput("[1, 2, 3]");

    expect(result).toBeNull();
    expect(errors.length).toBeGreaterThan(0);
  });

  it("fills defaults for missing fields", () => {
    const raw = '{"summary":"Only summary"}';

    const { result, errors } = parseClassificationOutput(raw);

    expect(errors).toEqual([]);
    expect(result).not.toBeNull();
    expect(result!.summary).toBe("Only summary");
    expect(result!.relevance).toBe(0);
    expect(result!.categories).toEqual([]);
    expect(result!.should_store).toBe(true);
  });

  it("normalizes category entries with missing fields", () => {
    const raw = '{"summary":"Test","relevance":0.5,"categories":[{}],"should_store":true}';

    const { result, errors } = parseClassificationOutput(raw);

    expect(errors).toEqual([]);
    expect(result).not.toBeNull();
    expect(result!.categories[0].category).toBe("");
    expect(result!.categories[0].subcategory).toBe("");
    expect(result!.categories[0].confidence).toBe(0);
  });
});

// ── validateClassificationResult ─────────────────────────────────────────────

describe("validateClassificationResult", () => {
  it("returns valid=true for a valid result", () => {
    const result = validResult();
    const validated = validateClassificationResult(result);

    expect(validated.valid).toBe(true);
    expect(validated.errors).toEqual([]);
  });

  it("errors when categories is empty and should_store=true", () => {
    const result = validResult();
    result.categories = [];

    const validated = validateClassificationResult(result);

    expect(validated.valid).toBe(false);
    expect(validated.errors.some((e) => e.includes("categories must not be empty"))).toBe(true);
  });

  it("no error when categories is empty and should_store=false", () => {
    const result: ClassificationResult = {
      summary: "",
      relevance: 0,
      categories: [],
      should_store: false,
    };

    const validated = validateClassificationResult(result);

    expect(validated.valid).toBe(true);
    expect(validated.errors).toEqual([]);
  });

  it("errors when relevance is out of range (> 1)", () => {
    const result = validResult();
    result.relevance = 1.5;

    const validated = validateClassificationResult(result);

    expect(validated.valid).toBe(false);
    expect(validated.errors.some((e) => e.includes("relevance"))).toBe(true);
  });

  it("errors when relevance is out of range (< 0)", () => {
    const result = validResult();
    result.relevance = -0.5;

    const validated = validateClassificationResult(result);

    expect(validated.valid).toBe(false);
    expect(validated.errors.some((e) => e.includes("relevance"))).toBe(true);
  });

  it("warns (not errors) when relevance < 0.3", () => {
    const result = validResult();
    result.relevance = 0.2;

    const validated = validateClassificationResult(result);

    expect(validated.valid).toBe(true);
    expect(validated.warnings.some((w) => w.includes("relevance=0.2"))).toBe(true);
  });

  it("errors when summary is empty and should_store=true", () => {
    const result = validResult();
    result.summary = "";

    const validated = validateClassificationResult(result);

    expect(validated.valid).toBe(false);
    expect(validated.errors.some((e) => e.includes("summary must not be empty"))).toBe(true);
  });

  it("errors when summary is too long (exceeds maxTokenPerEntry)", () => {
    const result = validResult();
    result.summary = "x".repeat(5000); // 5000 chars => ~1250 tokens, exceeds 1024 default

    const validated = validateClassificationResult(result);

    expect(validated.valid).toBe(false);
    expect(validated.errors.some((e) => e.includes("token limit"))).toBe(true);
  });

  it("warns when summary is very short (< 20 chars)", () => {
    const result = validResult();
    result.summary = "Short.";

    const validated = validateClassificationResult(result);

    // Short summary warning only, still valid
    expect(validated.warnings.some((w) => w.includes("very short"))).toBe(true);
  });

  it("errors when confidence is out of range", () => {
    const result = validResult();
    result.categories[0].confidence = 2.0;

    const validated = validateClassificationResult(result);

    expect(validated.valid).toBe(false);
    expect(validated.errors.some((e) => e.includes("confidence"))).toBe(true);
  });

  it("errors when categories count exceeds maxSubcategoryPerMemory", () => {
    const result = validResult();
    result.categories = Array.from({ length: 15 }, (_, i) => ({
      category: `Cat${i}`,
      subcategory: `Sub${i}`,
      confidence: 0.9,
    }));

    const validated = validateClassificationResult(result);

    expect(validated.valid).toBe(false);
    expect(validated.errors.some((e) => e.includes("exceeds max"))).toBe(true);
  });

  it("warns when should_store=false", () => {
    const result: ClassificationResult = {
      summary: "",
      relevance: 0,
      categories: [],
      should_store: false,
    };

    const validated = validateClassificationResult(result);

    expect(validated.warnings.some((w) => w.includes("will not be stored"))).toBe(true);
  });

  it("errors when category name is empty", () => {
    const result = validResult();
    result.categories[0].category = "";

    const validated = validateClassificationResult(result);

    expect(validated.valid).toBe(false);
    expect(validated.errors.some((e) => e.includes("category must be a non-empty string"))).toBe(true);
  });

  it("errors when subcategory name is empty", () => {
    const result = validResult();
    result.categories[0].subcategory = "";

    const validated = validateClassificationResult(result);

    expect(validated.valid).toBe(false);
    expect(validated.errors.some((e) => e.includes("subcategory must be a non-empty string"))).toBe(true);
  });

  it("returns result as null when invalid", () => {
    const result = validResult();
    result.relevance = 2.0;

    const validated = validateClassificationResult(result);

    expect(validated.valid).toBe(false);
    expect(validated.result).toBeNull();
  });

  it("respects custom maxTokenPerEntry option", () => {
    const result = validResult();
    result.summary = "x".repeat(1000); // ~250 tokens, within 500 limit

    const validated = validateClassificationResult(result, { maxTokenPerEntry: 500 });

    // 1000/4 = 250 > 500? No, 250 < 500, so valid
    expect(validated.valid).toBe(true);
  });

  it("respects custom maxSubcategoryPerMemory option", () => {
    const result = validResult();
    result.categories = Array.from({ length: 5 }, (_, i) => ({
      category: `Cat${i}`,
      subcategory: `Sub${i}`,
      confidence: 0.9,
    }));

    // 5 > 3, should error
    const validated = validateClassificationResult(result, { maxSubcategoryPerMemory: 3 });

    expect(validated.valid).toBe(false);
    expect(validated.errors.some((e) => e.includes("exceeds max"))).toBe(true);
  });
});

// ── quickShouldStore ────────────────────────────────────────────────────────

describe("quickShouldStore", () => {
  it('returns false for "hello"', () => {
    expect(quickShouldStore("hello")).toBe(false);
  });

  it('returns false for "hi"', () => {
    expect(quickShouldStore("hi")).toBe(false);
  });

  it('returns false for "who are you"', () => {
    expect(quickShouldStore("who are you")).toBe(false);
  });

  it('returns false for "who are you?"', () => {
    expect(quickShouldStore("who are you?")).toBe(false);
  });

  it('returns false for "你好"', () => {
    expect(quickShouldStore("你好")).toBe(false);
  });

  it('returns false for "ok"', () => {
    expect(quickShouldStore("ok")).toBe(false);
  });

  it('returns false for "thanks"', () => {
    expect(quickShouldStore("thanks")).toBe(false);
  });

  it('returns false for "bye"', () => {
    expect(quickShouldStore("bye")).toBe(false);
  });

  it('returns true for "What is the capital of France?"', () => {
    expect(quickShouldStore("What is the capital of France?")).toBe(true);
  });

  it('returns true for "Python uses indentation for code blocks"', () => {
    expect(quickShouldStore("Python uses indentation for code blocks")).toBe(true);
  });

  it("returns false for very short messages (< 10 chars)", () => {
    expect(quickShouldStore("abc")).toBe(false);
  });

  it("returns false for single word messages", () => {
    expect(quickShouldStore("test")).toBe(false);
  });

  it("returns false for just whitespace with short content", () => {
    expect(quickShouldStore("   hi   ")).toBe(false);
  });

  it('returns true for long content messages', () => {
    expect(quickShouldStore("The Rust programming language has a unique ownership model that prevents memory errors at compile time.")).toBe(true);
  });
});

// ── estimateTokens ──────────────────────────────────────────────────────────

describe("estimateTokens", () => {
  it('returns ~2-3 for "hello world"', () => {
    const tokens = estimateTokens("hello world");
    expect(tokens).toBeGreaterThanOrEqual(2);
    expect(tokens).toBeLessThanOrEqual(3);
  });

  it("returns 1 for short strings", () => {
    expect(estimateTokens("a")).toBe(1);
    expect(estimateTokens("")).toBe(1);
  });

  it("returns ceil(chars/4)", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2); // 5/4 = 1.25 -> ceil = 2
    expect(estimateTokens("12345678")).toBe(2); // 8/4 = 2
    expect(estimateTokens("123456789")).toBe(3); // 9/4 = 2.25 -> ceil = 3
  });
});

// ── formatCategoriesForDisplay ──────────────────────────────────────────────

describe("formatCategoriesForDisplay", () => {
  it("returns placeholder for empty categories", () => {
    expect(formatCategoriesForDisplay([])).toBe("(no categories)");
  });

  it("formats single category correctly", () => {
    const cats: ClassificationCategory[] = [
      { category: "Programming", subcategory: "Python", confidence: 0.95 },
    ];

    const result = formatCategoriesForDisplay(cats);
    expect(result).toContain("Programming");
    expect(result).toContain("Python");
    expect(result).toContain("95%");
  });

  it("sorts categories by confidence descending", () => {
    const cats: ClassificationCategory[] = [
      { category: "Low", subcategory: "L", confidence: 0.3 },
      { category: "High", subcategory: "H", confidence: 0.95 },
      { category: "Mid", subcategory: "M", confidence: 0.6 },
    ];

    const result = formatCategoriesForDisplay(cats);

    // High should appear first
    const highIdx = result.indexOf("High");
    const midIdx = result.indexOf("Mid");
    const lowIdx = result.indexOf("Low");

    expect(highIdx).toBeLessThan(midIdx);
    expect(midIdx).toBeLessThan(lowIdx);
  });
});

// ── checkCategorySimilarity ─────────────────────────────────────────────────

describe("checkCategorySimilarity", () => {
  it("returns empty array when no similar categories exist", () => {
    const warnings = checkCategorySimilarity(
      [{ category: "Programming", subcategory: "Rust", confidence: 0.9 }],
      ["Art", "Music", "History"],
    );

    expect(warnings).toEqual([]);
  });

  it("returns empty array when categories match existing exactly (case-insensitive)", () => {
    const warnings = checkCategorySimilarity(
      [{ category: "Programming", subcategory: "Rust", confidence: 0.9 }],
      ["Programming", "Art"],
    );

    expect(warnings).toEqual([]);
  });

  it("warns when new category is very similar to existing", () => {
    const warnings = checkCategorySimilarity(
      [{ category: "Programing", subcategory: "Rust", confidence: 0.9 }],
      ["Programming", "Art"],
    );

    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("very similar");
  });

  it("warns for near-typo matches", () => {
    const warnings = checkCategorySimilarity(
      [{ category: "Pythom", subcategory: "Basics", confidence: 0.9 }],
      ["Python", "Java"],
    );

    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("very similar");
  });
});
