import { spawn } from "child_process";
import { resolve, dirname } from "path";
import { homedir } from "os";
import { appendFileSync, mkdirSync } from "fs";
import type { PluginConfig } from "./config";

function ensureLogDir(filePath: string): void {
  try { mkdirSync(dirname(filePath), { recursive: true }); } catch { /* noop */ }
}

function makeLogError(errorsLogPath: string) {
  return function logError(msg: string): void {
    ensureLogDir(errorsLogPath);
    try {
      appendFileSync(errorsLogPath, `[retrieval] ${new Date().toISOString()} ${msg}\n`);
    } catch {
      // silently ignore logging failures
    }
  };
}

// ── Keyword derivation ────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "can", "shall", "to", "of", "in", "for",
  "on", "with", "at", "by", "from", "as", "into", "through", "during",
  "before", "after", "above", "below", "between", "under", "again",
  "further", "then", "once", "here", "there", "when", "where", "why",
  "how", "what", "which", "who", "whom", "whose", "all", "both",
  "each", "few", "more", "most", "other", "some", "such", "no", "not",
  "only", "own", "same", "so", "than", "too", "very", "just", "about",
  "now", "it", "its", "i", "me", "my", "we", "our", "you", "your",
  "he", "she", "they", "them", "this", "that", "these", "those", "and",
  "but", "or", "if", "while", "because", "until", "up", "out", "any",
  "get", "got", "make", "made", "let", "also",
]);

export function deriveKeyword(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";

  const words = trimmed.split(/[\s,.;:!?()"']+/);
  for (const raw of words) {
    const cleaned = raw.replace(/[^a-zA-Z0-9]/g, "");
    const lower = cleaned.toLowerCase();
    if (!lower) continue;
    if (/^\d+$/.test(lower)) continue;
    if (STOP_WORDS.has(lower)) continue;
    return lower;
  }

  return "";
}

// ── Cache ─────────────────────────────────────────────────────────────────

interface CacheEntry {
  systemLines: string[];
  visibleLines: string[];
  timestamp: number;
}

const retrievalCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000; // 60s

export function clearRetrievalCache(): void {
  retrievalCache.clear();
}

function buildCacheKey(sessionID: string, lastUserMessageID: string): string {
  return `${sessionID}::${lastUserMessageID}`;
}

// ── CLI query execution ───────────────────────────────────────────────────

export interface MemoryRow {
  id: number;
  summary: string;
  content: string;
  content_hash: string;
  relevance: number;
  category?: string;
  subcategory?: string;
}

export type QueryFn = (
  dbPath: string,
  keyword: string,
  limit: number,
  relevance: number,
) => Promise<MemoryRow>;

export async function queryMemories(
  dbPath: string,
  keyword: string,
  limit: number,
  relevance: number,
): Promise<MemoryRow[]> {
  const args = [
    "run",
    resolve(__dirname, "..", "src", "cli.ts"),
    "query",
    "--limit", String(limit),
    "--relevance", String(relevance),
  ];

  if (keyword) {
    args.push("--keyword", keyword);
  }

  return new Promise((resolve) => {
    const proc = spawn("bun", args, {
      cwd: resolve(__dirname, ".."),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      logError(`CLI spawn error: ${err.message}`);
      resolve([]);
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        if (stderr) logError(`CLI query exit=${code}: ${stderr.slice(0, 200)}`);
        resolve([]);
        return;
      }

      try {
        const parsed = JSON.parse(stdout.trim());
        resolve(Array.isArray(parsed) ? parsed : []);
      } catch {
        resolve([]);
      }
    });
  });
}

// ── Display formatting ────────────────────────────────────────────────────

export function formatMemoryLines(memories: MemoryRow[]): string[] {
  if (memories.length === 0) return [];

  const lines: string[] = [];
  lines.push("## RELEVANT MEMORIES");
  lines.push("");
  for (const m of memories) {
    const rel = m.relevance.toFixed(2);
    lines.push(`- [${rel}] ${m.summary || m.content.slice(0, 100)}`);
  }
  lines.push("");
  return lines;
}

export function formatMemorySystemLines(memories: MemoryRow[]): string[] {
  if (memories.length === 0) return [];

  const lines: string[] = [];
  lines.push("<memory_context>");
  for (const m of memories) {
    lines.push(`- ${m.summary || m.content.slice(0, 200)}`);
  }
  lines.push("</memory_context>");
  return lines;
}

// ── Retrieval engine (module-level, cache-aware) ──────────────────────────

export async function performRetrieval(
  sessionID: string,
  dbPath: string,
  userMessageText: string | undefined,
  display: boolean,
  opts?: { cacheKey?: string; queryFn?: QueryFn; errorsLogPath?: string },
): Promise<{ systemLines: string[]; visibleLines: string[] }> {
  const key = opts?.cacheKey ?? buildCacheKey(sessionID, "");
  const queryFn = opts?.queryFn ?? queryMemories;
  const logError = makeLogError(opts?.errorsLogPath ?? resolve(homedir(), ".config", "opencode", "neuro-memory", "errors.log"));

  // Check cache
  const cached = retrievalCache.get(key);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
    return { systemLines: cached.systemLines, visibleLines: cached.visibleLines };
  }

  const keyword = userMessageText ? deriveKeyword(userMessageText) : "";
  const DEFAULT_LIMIT = 3;
  const DEFAULT_RELEVANCE = 0.75;

  let memories: MemoryRow[] = [];
  try {
    memories = await queryFn(dbPath, keyword, DEFAULT_LIMIT, DEFAULT_RELEVANCE);
  } catch (err) {
    logError(`queryMemories exception: ${(err as Error).message}`);
    memories = [];
  }

  const systemLines = formatMemorySystemLines(memories);
  const visibleLines = display ? formatMemoryLines(memories) : [];

  // Store in cache
  retrievalCache.set(key, { systemLines, visibleLines, timestamp: Date.now() });

  return { systemLines, visibleLines };
}

// ── Hook factory ──────────────────────────────────────────────────────────

export type RetrievalHookFactory = typeof createRetrievalHook;

export function createRetrievalHook(
  hooks: Record<string, any>,
  input: { directory: string },
  config: PluginConfig,
  opts?: { errorsLogPath?: string },
): void {
  const { display, dbPath } = config;
  const errorsLogPath = opts?.errorsLogPath ?? resolve(homedir(), ".config", "opencode", "neuro-memory", "errors.log");

  const hasSystemTransform = typeof hooks["experimental.chat.system.transform"] === "function";
  const hasMessagesTransform = typeof hooks["experimental.chat.messages.transform"] === "function";

  if (!hasSystemTransform && !hasMessagesTransform) {
    return;
  }

  const logError = makeLogError(errorsLogPath);

  // Primary: experimental.chat.system.transform
  if (hasSystemTransform) {
    const originalSystemTransform = hooks["experimental.chat.system.transform"];

    hooks["experimental.chat.system.transform"] = async (
      hookInput: { sessionID?: string; model: unknown },
      output: { system: string[] },
    ) => {
      const sessionID = hookInput.sessionID ?? "unknown";

      try {
        const { systemLines, visibleLines } = await performRetrieval(
          sessionID,
          dbPath,
          undefined,
          display,
          { cacheKey: buildCacheKey(sessionID, ""), errorsLogPath },
        );

        output.system.push(...systemLines);
        if (display && visibleLines.length > 0) {
          output.system.push(...visibleLines);
        }
      } catch (err) {
        logError(`system.transform error: ${(err as Error).message}`);
      }

      await originalSystemTransform?.(hookInput, output);
    };
  }

  // Fallback: experimental.chat.messages.transform
  if (hasMessagesTransform && !hasSystemTransform) {
    const originalMessagesTransform = hooks["experimental.chat.messages.transform"];

    hooks["experimental.chat.messages.transform"] = async (
      hookInput: Record<string, unknown>,
      output: { messages: Array<{ info: { role: string }; parts: Array<{ type: string; text?: string }> }> },
    ) => {
      try {
        const sessionID = (hookInput as any).sessionID ?? "unknown";
        const messages = output.messages;

        let userText = "";
        // Derive a stable content fingerprint for the cache key
        let contentFingerprint = "";
        if (messages.length > 0) {
          const lastMsg = messages[messages.length - 1];
          for (const part of lastMsg.parts) {
            if (part.type === "text" && part.text) {
              userText += part.text;
            }
          }
          contentFingerprint = userText.replace(/\s/g, "").slice(0, 80) + ":" + userText.length;
        }

        const msgCacheKey = buildCacheKey(sessionID, contentFingerprint || "__no_text__");

        const { systemLines, visibleLines } = await performRetrieval(
          sessionID,
          dbPath,
          userText,
          display,
          { cacheKey: msgCacheKey, errorsLogPath },
        );

        if (display && visibleLines.length > 0) {
          messages.unshift({
            info: { role: "user" },
            parts: [{ type: "text", text: visibleLines.join("\n") }],
          });
        }

        if (systemLines.length > 0) {
          messages.unshift({
            info: { role: "system" },
            parts: [{ type: "text", text: systemLines.join("\n") }],
          });
        }
      } catch (err) {
        logError(`messages.transform error: ${(err as Error).message}`);
      }

      await originalMessagesTransform?.(hookInput, output);
    };
  }
}
