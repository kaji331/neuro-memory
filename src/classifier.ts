// ── Type definitions ─────────────────────────────────────────────────────────

export interface ClassificationCategory {
  category: string;       // existing or new category name
  subcategory: string;    // existing or new subcategory name
  confidence: number;     // 0.0 - 1.0
}

export interface ClassificationResult {
  summary: string;              // 1-2 sentence summary, < 1K tokens
  relevance: number;            // 0.0 - 1.0
  categories: ClassificationCategory[];  // 1 or more (unless should_store=false)
  should_store: boolean;        // false for greetings, small talk, etc.
}

export interface ValidatedResult {
  valid: boolean;
  result: ClassificationResult | null;
  errors: string[];
  warnings: string[];
}

export interface ClassifierOptions {
  maxTokenPerEntry: number;       // from config
  maxSubcategoryPerMemory: number; // from config
}

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_OPTIONS: ClassifierOptions = {
  maxTokenPerEntry: 1024,
  maxSubcategoryPerMemory: 10,
};

function resolveOptions(options?: Partial<ClassifierOptions>): ClassifierOptions {
  return { ...DEFAULT_OPTIONS, ...options };
}

// ── Greeting / small-talk quick filter ───────────────────────────────────────

/**
 * List of phrases that indicate a non-content turn (greetings, small talk, meta questions).
 * All comparisons are case-insensitive.
 */
const NON_CONTENT_PATTERNS: { test: (s: string) => boolean; label: string }[] = [
  { test: (s) => /^(hi|hey|hello|yo|sup|heya|hola|howdy)$/i.test(s), label: "greeting" },
  { test: (s) => /^(早上好|下午好|晚上好|你好|嗨|喂|您好)$/u.test(s), label: "greeting-zh" },
  { test: (s) => /^(good\s+(morning|afternoon|evening|night))$/i.test(s), label: "greeting" },
  { test: (s) => /^(later|bye|goodbye|see\s+ya|cya|bb|ttyl|peace)$/i.test(s), label: "farewell" },
  { test: (s) => /^(拜拜|再见|回头见|下次见)$/u.test(s), label: "farewell-zh" },
  { test: (s) => /^(thanks|thank\s+you|thx|ty|tyvm|muchas\s+gracias|merci|danke)$/i.test(s), label: "thanks" },
  { test: (s) => /^(谢谢|多谢|感谢|谢谢你)$/u.test(s), label: "thanks-zh" },
  { test: (s) => /^(ok|okay|k|kk|got\s+it|understood|alright|fine|cool|sure)$/i.test(s), label: "ack" },
  { test: (s) => /^(好的|明白了|知道了|收到|嗯|哦|行)$/u.test(s), label: "ack-zh" },
  { test: (s) => /^(who\s+are\s+you|what\s+are\s+you|what\s+can\s+you\s+do|what\s+do\s+you\s+do)\??$/i.test(s), label: "meta" },
  { test: (s) => /^(你是谁|你能做什么|你会什么|你是做什么的)\??$/u.test(s), label: "meta-zh" },
  { test: (s) => /^(yes|no|yep|nope|nah|yeah|y|n)$/i.test(s), label: "binary" },
  { test: (s) => /^(是|对|否|不|不是)$/u.test(s), label: "binary-zh" },
];

/**
 * Quick check: should this conversation content be stored?
 * Runs a lightweight check before calling the LLM to filter obvious non-content.
 *
 * Returns false for:
 * - Messages shorter than 10 characters
 * - Messages that are only greetings, farewells, acknowledgments, thanks
 * - Messages that are only questions about the agent
 * - Messages that are only single words
 */
export function quickShouldStore(conversationTurn: string): boolean {
  const trimmed = conversationTurn.trim();

  // Very short messages
  if (trimmed.length < 10) {
    return false;
  }

  // Single word
  if (/^\S+$/u.test(trimmed)) {
    return false;
  }

  // Check against non-content patterns
  for (const pat of NON_CONTENT_PATTERNS) {
    if (pat.test(trimmed)) {
      return false;
    }
  }

  return true;
}

// ── Token estimation ─────────────────────────────────────────────────────────

/**
 * Estimate token count from string (rough: chars / 4).
 * This is a conservative heuristic for mixed English/Chinese text.
 */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

// ── Classification prompt builder ────────────────────────────────────────────

/**
 * Build the prompt for the summarization/classification subagent.
 *
 * @param conversationTurn - The user message + agent response to summarize
 * @param existingCategories - List of existing categories (name only) for the LLM to prefer
 * @param options - Classifier options
 * @returns The full prompt string to send to the LLM
 */
export function buildClassificationPrompt(
  conversationTurn: string,
  existingCategories: string[],
  options?: Partial<ClassifierOptions>,
): string {
  const opts = resolveOptions(options);

  const categoryList = existingCategories.length > 0
    ? existingCategories.map((c) => `  - "${c}"`).join("\n")
    : "  (no existing categories yet — feel free to create new ones)";

  const lines = [
    "You are a knowledge classifier. Extract the core knowledge/insight from this conversation turn.",
    "",
    "## Task",
    "Read the conversation below and produce a structured classification. ",
    "Your output describes what the user learned, decided, or discovered.",
    "",
    "## Existing Categories",
    "These are the existing categories. PREFER using existing ones over creating new ones:",
    categoryList,
    "",
    "## Output Format",
    "Return ONLY valid JSON matching this schema:",
    "",
    "```json",
    "{",
    '  "summary": "1-2 sentence self-contained factual summary",',
    '  "relevance": 0.75,',
    '  "categories": [',
    '    {',
    '      "category": "existing-or-new-category-name",',
    '      "subcategory": "existing-or-new-subcategory-name",',
    '      "confidence": 0.9',
    '    }',
    '  ],',
    '  "should_store": true',
    "}",
    "```",
    "",
    "## Examples",
    "",
    "Input: \"User asked about Python list comprehensions. Agent explained syntax and gave examples.\"",
    "Output:",
    "{",
    '  "summary": "Python list comprehensions provide concise syntax for creating lists: [expr for item in iterable if condition]. They are more readable and often faster than equivalent for-loops.",',
    '  "relevance": 0.85,',
    '  "categories": [{"category": "Programming", "subcategory": "Python", "confidence": 0.95}],',
    '  "should_store": true',
    "}",
    "",
    "Input: \"User: hello\\nAgent: Hi! How can I help you today?\"",
    "Output:",
    "{",
    '  "summary": "",',
    '  "relevance": 0.0,',
    '  "categories": [],',
    '  "should_store": false',
    "}",
    "",
    "## Guardrails",
    `- If the conversation is greeting/small talk (hello, how are you, who are you, etc.), set should_store=false and leave summary empty.`,
    "- Summary must be self-contained. Don't reference 'this conversation' or 'the user' — state the fact directly.",
    `- Summary must be < ${opts.maxTokenPerEntry} tokens (roughly ${opts.maxTokenPerEntry * 4} characters).`,
    "- Prefer existing categories. Only create new ones if the content truly doesn't fit.",
    `- A memory can belong to up to ${opts.maxSubcategoryPerMemory} subcategories.`,
    "- Relevance reflects how useful this knowledge is. 0.0 = trivial/noise, 1.0 = critical insight.",
    "- Confidence per category reflects how sure you are about the classification. 0.0 = guess, 1.0 = certain.",
    "",
    "## Conversation Turn",
    conversationTurn,
    "",
    "Return ONLY valid JSON. No markdown fences, no explanatory text.",
  ];

  return lines.join("\n");
}

// ── Output parser ────────────────────────────────────────────────────────────

/**
 * Strip markdown code fences from raw LLM output.
 * Handles:
 * - ```json ... ```
 * - ``` ... ```
 * - Leading/trailing whitespace
 */
function stripMarkdownFences(raw: string): string {
  let s = raw.trim();

  // Strip opening fence: ```json, ```JSON, ```, etc.
  const openFence = s.match(/^```(?:\w*\s*)?\n?/);
  if (openFence) {
    s = s.slice(openFence[0].length);
  }

  // Strip closing fence: ```
  const closeFence = s.match(/\n?```\s*$/);
  if (closeFence) {
    s = s.slice(0, -closeFence[0].length);
  }

  return s.trim();
}

/**
 * Parse the raw string output from the LLM into a ClassificationResult.
 * Handles:
 * - Markdown code fences (```json ... ```)
 * - Leading/trailing whitespace
 * - Partial parsing errors (returns errors array, doesn't throw)
 */
export function parseClassificationOutput(raw: string): {
  result: ClassificationResult | null;
  errors: string[];
} {
  const errors: string[] = [];

  if (!raw || raw.trim() === "") {
    errors.push("Empty LLM output — nothing to parse");
    return { result: null, errors };
  }

  const cleaned = stripMarkdownFences(raw);

  try {
    const parsed = JSON.parse(cleaned);

    // Validate that the parsed object has the expected shape at minimum
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      errors.push("LLM output is not a JSON object");
      return { result: null, errors };
    }

    // Ensure arrays and defaults for missing fields
    const result: ClassificationResult = {
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      relevance: typeof parsed.relevance === "number" ? parsed.relevance : 0,
      categories: Array.isArray(parsed.categories) ? parsed.categories : [],
      should_store: typeof parsed.should_store === "boolean" ? parsed.should_store : true,
    };

    // Normalize categories array entries
    result.categories = result.categories.map((cat: Record<string, unknown>) => ({
      category: typeof cat.category === "string" ? cat.category : "",
      subcategory: typeof cat.subcategory === "string" ? cat.subcategory : "",
      confidence: typeof cat.confidence === "number" ? cat.confidence : 0,
    }));

    return { result, errors };
  } catch (err) {
    errors.push(`JSON parse error: ${(err as Error).message}`);
    return { result: null, errors };
  }
}

// ── Validator ────────────────────────────────────────────────────────────────

/**
 * Validate a parsed ClassificationResult against business rules.
 * Returns warnings (non-critical) and errors (critical).
 */
export function validateClassificationResult(
  result: ClassificationResult,
  options?: Partial<ClassifierOptions>,
): ValidatedResult {
  const opts = resolveOptions(options);
  const errors: string[] = [];
  const warnings: string[] = [];

  // ── relevance ───────────────────────────────────────────────────────────
  if (typeof result.relevance !== "number" || isNaN(result.relevance)) {
    errors.push("relevance must be a number");
  } else if (result.relevance < 0 || result.relevance > 1) {
    errors.push(`relevance must be in range [0.0, 1.0], got ${result.relevance}`);
  } else if (result.relevance < 0.3) {
    warnings.push(`Low confidence memory (relevance=${result.relevance}), consider skipping`);
  }

  // ── summary ─────────────────────────────────────────────────────────────
  if (result.should_store) {
    if (typeof result.summary !== "string" || result.summary.trim() === "") {
      errors.push("summary must not be empty when should_store=true");
    } else {
      const estimatedTokens = estimateTokens(result.summary);
      if (estimatedTokens > opts.maxTokenPerEntry) {
        errors.push(
          `summary exceeds token limit: ~${estimatedTokens} tokens (max: ${opts.maxTokenPerEntry})`,
        );
      }
      if (result.summary.trim().length < 20) {
        warnings.push(
          `summary is very short (${result.summary.trim().length} chars), may lack sufficient detail`,
        );
      }
    }
  }

  // ── categories ──────────────────────────────────────────────────────────
  if (!Array.isArray(result.categories)) {
    errors.push("categories must be an array");
  } else if (result.should_store && result.categories.length === 0) {
    errors.push("categories must not be empty when should_store=true");
  } else if (result.categories.length > opts.maxSubcategoryPerMemory) {
    errors.push(
      `categories count (${result.categories.length}) exceeds max of ${opts.maxSubcategoryPerMemory}`,
    );
  }

  // Validate each category entry
  for (let i = 0; i < result.categories.length; i++) {
    const cat = result.categories[i];
    const prefix = `categories[${i}]`;

    if (typeof cat.category !== "string" || cat.category.trim() === "") {
      errors.push(`${prefix}.category must be a non-empty string`);
    }
    if (typeof cat.subcategory !== "string" || cat.subcategory.trim() === "") {
      errors.push(`${prefix}.subcategory must be a non-empty string`);
    }
    if (typeof cat.confidence !== "number" || isNaN(cat.confidence)) {
      errors.push(`${prefix}.confidence must be a number`);
    } else if (cat.confidence < 0 || cat.confidence > 1) {
      errors.push(`${prefix}.confidence must be in range [0.0, 1.0], got ${cat.confidence}`);
    }
  }

  // ── should_store ───────────────────────────────────────────────────────
  if (!result.should_store) {
    warnings.push("Memory will not be stored (should_store=false)");
  }

  return {
    valid: errors.length === 0,
    result: errors.length === 0 ? result : null,
    errors,
    warnings,
  };
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  let curr: number[] = new Array(n + 1);

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

/**
 * Validate categories against an existing list of known category names.
 * Checks for near-duplicates (case-insensitive comparison).
 * This is an additional validation step that can be run after parse + validate.
 */
export function checkCategorySimilarity(
  categories: ClassificationCategory[],
  existingCategories: string[],
): string[] {
  const warnings: string[] = [];
  const lowerExisting = existingCategories.map((c) => c.toLowerCase().trim());

  for (const cat of categories) {
    const lowerCat = cat.category.toLowerCase().trim();

    if (lowerExisting.includes(lowerCat)) {
      continue;
    }

    for (const existing of lowerExisting) {
      if (existing.length === 0 || lowerCat.length === 0) continue;

      const maxLen = Math.max(existing.length, lowerCat.length);
      const distance = levenshteinDistance(existing, lowerCat);
      const similarity = 1 - distance / maxLen;

      if (similarity >= 0.7) {
        warnings.push(
          `New category "${cat.category}" is very similar to existing category (case-insensitive match of "${existing}")`,
        );
        break;
      }
    }
  }

  return warnings;
}

// ── Display formatter ───────────────────────────────────────────────────────

/**
 * Get a relevance-weighted summary of categories for display.
 * Format: "Category > Subcategory (confidence)" sorted by confidence descending.
 */
export function formatCategoriesForDisplay(categories: ClassificationCategory[]): string {
  if (categories.length === 0) {
    return "(no categories)";
  }

  const sorted = [...categories].sort((a, b) => b.confidence - a.confidence);

  return sorted
    .map((c) => `${c.category} > ${c.subcategory} (${(c.confidence * 100).toFixed(0)}%)`)
    .join(", ");
}
