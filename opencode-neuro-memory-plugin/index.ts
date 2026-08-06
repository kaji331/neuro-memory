/**
 * neuro-memory opencode plugin.
 *
 * Enable in opencode.json: add the path to this plugin/ directory to the "plugin" array.
 * Example:
 *   { "plugin": ["/home/kaji331/.agents/skills/neuro-memory/opencode-neuro-memory-plugin"] }
 *
 * The plugin directory contains a package.json whose default export (server.ts)
 * provides { id: "neuro-memory", server: neuroMemoryPlugin } — the format opencode
 * v1.18.12 expects for local directory entries in the plugin array.
 *
 * Default display:false = fully silent retrieval & recording.
 * Set display:true in neuro-memory.yaml to surface retrieved memories in chat.
 * The plugin directory is auto-synced by the "neuro-memory update" bunx command.
 */
import { resolve, dirname } from "path";
import { homedir } from "os";
import { mkdirSync, appendFileSync, existsSync } from "fs";
import type { Plugin, Hooks, PluginInput } from "@opencode-ai/plugin";

import { loadPluginConfig } from "./config";
import { createRecordingHook } from "./recording";
import { createRetrievalHook } from "./retrieval";

const ERRORS_LOG_PATH = resolve(homedir(), ".config", "opencode", "neuro-memory", "errors.log");

function ensureDir(path: string): void {
  try {
    mkdirSync(path, { recursive: true });
  } catch {
    // read-only fs — non-fatal
  }
}

function logErrorToFile(message: string): void {
  ensureDir(dirname(ERRORS_LOG_PATH));
  try {
    appendFileSync(
      ERRORS_LOG_PATH,
      `[plugin-init] ${new Date().toISOString()} ${message}\n`,
      "utf-8",
    );
  } catch {
    // noop — can't even write to errors log
  }
}

function ensureDbDir(dbPath: string): void {
  try {
    mkdirSync(dirname(dbPath), { recursive: true });
  } catch {
    logErrorToFile(`Cannot create DB directory: ${dirname(dbPath)}`);
  }
}

function tryInitDbSchema(
  dbPath: string,
): boolean {
  try {
    const { Database } = require("bun:sqlite") as { Database: typeof import("bun:sqlite").Database };
    const db = new Database(dbPath);

    try {
      db.run("PRAGMA journal_mode=WAL;");
      db.run("PRAGMA foreign_keys=ON;");

      const userVersionRow = db
        .query("PRAGMA user_version;")
        .get() as { user_version: number } | undefined;

      if (userVersionRow && userVersionRow.user_version > 0) {
        db.close();
        return true;
      }

      // Schema not initialized — run init
      const { CREATE_TABLES_SQL, CREATE_INDEXES_SQL, SCHEMA_VERSION } = require("../src/db/schema");
      for (const sql of CREATE_TABLES_SQL) {
        db.run(sql);
      }
      for (const sql of CREATE_INDEXES_SQL) {
        db.run(sql);
      }
      db.run("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);");
      const row = db
        .query("SELECT version FROM schema_version ORDER BY version DESC LIMIT 1")
        .get() as { version: number } | undefined;
      if (!row) {
        db.run("INSERT INTO schema_version (version) VALUES (?);", [SCHEMA_VERSION]);
      }

      // Set user_version for fast check on next init
      db.run(`PRAGMA user_version = ${SCHEMA_VERSION};`);

      db.close();
      return true;
    } catch (err) {
      // DB file exists but is corrupt — log and continue
      logErrorToFile(`Corrupt/mismatched DB at "${dbPath}": ${(err as Error).message}`);
      try {
        db.close();
      } catch {
        // already broken
      }
      return false;
    }
  } catch (err) {
    // new Database() failed — DB file is corrupt or path inaccessible
    logErrorToFile(`Cannot open DB at "${dbPath}": ${(err as Error).message}`);
    return false;
  }
}

function resolveConfigPath(directory: string): string {
  const { existsSync } = require("fs") as typeof import("fs");
  const projectPath = resolve(directory, "neuro-memory.yaml");
  if (existsSync(projectPath)) return projectPath;
  const fallbackPath = resolve(homedir(), ".agents", "skills", "neuro-memory", "neuro-memory.yaml");
  if (existsSync(fallbackPath)) return fallbackPath;
  return resolve(homedir(), ".agents", "skills", "neuro-memory", "neuro-memory.yaml");
}

function createFetchMessagesAdapter(input: PluginInput) {
  return async (sessionID: string): Promise<{ lastMessageID: string; turnText: string }> => {
    let lastMessageID = "";
    let turnText = "";

    try {
      const response = await input.client.session.messages({
        path: { id: sessionID },
      });

      const data = (response as any).data;
      const messages: any[] = data?.messages ?? data ?? [];

      if (messages.length === 0) {
        return { lastMessageID: "", turnText: "" };
      }

      // Get last message ID
      const lastMsg = messages[messages.length - 1];
      lastMessageID = lastMsg?.info?.id ?? lastMsg?.id ?? "";

      // Extract text from the last user+assistant turn
      // Walk backwards to find user and assistant messages
      const turnMessages: any[] = [];
      let foundAssistant = false;
      let foundUser = false;

      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        const role = msg?.info?.role ?? msg?.role ?? "";

        if (!foundAssistant && role === "assistant") {
          turnMessages.unshift(msg);
          foundAssistant = true;
        } else if (role === "user") {
          turnMessages.unshift(msg);
          foundUser = true;
        } else if (foundAssistant || foundUser) {
          // Stop at the previous assistant message (end of previous turn)
          if (role === "assistant") break;
          if (role === "user") break;
        }
        // Only stop adding once we have a complete turn
        if (foundUser && foundAssistant) break;
      }

      // Build text from parts
      const parts: string[] = [];
      for (const msg of turnMessages) {
        for (const part of (msg?.parts ?? [])) {
          if (part?.text) parts.push(part.text);
        }
      }
      turnText = parts.join("\n\n").trim();

      return { lastMessageID, turnText };
    } catch (err) {
      logErrorToFile(`fetchMessages failed for session "${sessionID}": ${(err as Error).message}`);
      return { lastMessageID: "", turnText: "" };
    }
  };
}

export const neuroMemoryPlugin: Plugin = async (
  input: PluginInput,
  _options?: Record<string, unknown>,
): Promise<Hooks> => {
  const config = loadPluginConfig(input.directory);
  const dbPath = config.dbPath;
  const display = config.display;

  ensureDir(dirname(ERRORS_LOG_PATH));
  ensureDbDir(dbPath);

  // Schema init — non-fatal (AC-Z7)
  tryInitDbSchema(dbPath);

  const configPath = resolveConfigPath(input.directory);
  const cliPath = resolve(__dirname, "..", "src", "cli.ts");

  // Build the real fetchMessages adapter using ctx.client
  const fetchMessages = createFetchMessagesAdapter(input);

  const recordingHook = createRecordingHook({
    display,
    dbPath,
    configPath,
    cliPath,
    errorsLogPath: ERRORS_LOG_PATH,
    fetchMessages,
  });

  const hooks: Hooks = {};

  // Event hook — dispatch all events; recording filters internally
  hooks.event = async (eventInput: { event: any }) => {
    await recordingHook({ event: eventInput.event });
  };

  // Retrieval hooks
  createRetrievalHook(hooks as Record<string, any>, { directory: input.directory }, { display, dbPath }, { errorsLogPath: ERRORS_LOG_PATH });

  return hooks;
};

export default neuroMemoryPlugin;
