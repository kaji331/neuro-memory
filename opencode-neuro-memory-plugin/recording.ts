import { writeFileSync, unlinkSync, appendFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { tmpdir } from "os";

export interface RecordingOptions {
  display: boolean;
  dbPath: string;
  configPath: string;
  cliPath: string;
  errorsLogPath: string;
  fetchMessages: (sessionID: string) => Promise<{ lastMessageID: string; turnText: string }>;
}

interface LastProcessedEntry {
  lastMessageID: string;
  timestamp: number;
}

interface MessageEntry {
  info: { id: string };
  parts: Array<{ text?: string }>;
}

const DEBOUNCE_MS = 2000;
const IDEMPOTENCY_WINDOW_MS = 30000;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const SUBPROCESS_TTL_MS = 30000;

function ensureLogDir(filePath: string): void {
  try { mkdirSync(dirname(filePath), { recursive: true }); } catch { /* noop */ }
}

export function createRecordingHook(opts: RecordingOptions) {
  const state = {
    debounceTimer: null as Timer | null,
    debounceSessionID: null as string | null,
    lastProcessed: new Map<string, LastProcessedEntry>(),
    failureCount: new Map<string, number>(),
  };

  function isIdleEvent(input: { event: { type: string; properties?: Record<string, unknown> } }): string | null {
    const evt = input?.event;
    if (!evt) return null;
    const type = evt.type;
    const props = evt.properties;

    if (type === "session.idle") {
      return (props?.sessionID as string) ?? null;
    }

    if (type === "session.status" && props) {
      const status = props.status as { type?: string } | undefined;
      if (status?.type === "idle") {
        return (props.sessionID as string) ?? null;
      }
    }

    return null;
  }

  function clearDebounce(): void {
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = null;
      state.debounceSessionID = null;
    }
  }

  function scheduleDebounce(sessionID: string): void {
    clearDebounce();
    state.debounceTimer = setTimeout(() => {
      state.debounceTimer = null;
      state.debounceSessionID = null;
      runPipeline(sessionID);
    }, DEBOUNCE_MS);
    state.debounceSessionID = sessionID;
  }

  function isCircuitOpen(sessionID: string): boolean {
    return (state.failureCount.get(sessionID) ?? 0) >= CIRCUIT_BREAKER_THRESHOLD;
  }

  function recordFailure(sessionID: string): void {
    const current = state.failureCount.get(sessionID) ?? 0;
    state.failureCount.set(sessionID, current + 1);

    if (current + 1 === CIRCUIT_BREAKER_THRESHOLD) {
      logError(sessionID, `Circuit breaker opened after ${CIRCUIT_BREAKER_THRESHOLD} consecutive failures.`);
    }
  }

  function resetFailures(sessionID: string): void {
    state.failureCount.set(sessionID, 0);
  }

  function isDuplicate(sessionID: string, lastMessageID: string): boolean {
    const entry = state.lastProcessed.get(sessionID);
    if (!entry) return false;
    if (entry.lastMessageID !== lastMessageID) return false;
    return (Date.now() - entry.timestamp) < IDEMPOTENCY_WINDOW_MS;
  }

  function markProcessed(sessionID: string, lastMessageID: string): void {
    state.lastProcessed.set(sessionID, { lastMessageID, timestamp: Date.now() });
  }

  function displayLog(message: string): void {
    if (opts.display) {
      console.log(`[neuro-memory] ${message}`);
    }
  }

  function logError(sessionID: string, error: string): void {
    ensureLogDir(opts.errorsLogPath);
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [session=${sessionID}] ${error}\n`;
    try {
      appendFileSync(opts.errorsLogPath, line, "utf-8");
    } catch { /* noop */ }
  }

  function writeTmpFile(content: string): string {
    const tmpPath = resolve(tmpdir(), `neuro-memory-turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`);
    writeFileSync(tmpPath, content, "utf-8");
    return tmpPath;
  }

  function buildCommand(inputFile: string): string[] {
    return [
      "bun",
      "run",
      opts.cliPath,
      "summarize",
      "--input-file",
      inputFile,
      "--config",
      opts.configPath,
    ];
  }

  function spawnSubprocess(
    sessionID: string,
    turn: string,
  ): void {
    let tmpPath = "";
    try {
      tmpPath = writeTmpFile(turn);
    } catch (err) {
      logError(sessionID, `Failed to write temp file: ${(err as Error).message}`);
      recordFailure(sessionID);
      return;
    }

    const cmd = buildCommand(tmpPath);

    let child: ReturnType<typeof Bun.spawn>;
    try {
      child = Bun.spawn({
        cmd,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env },
      });
    } catch (err) {
      logError(sessionID, `Failed to spawn subprocess: ${(err as Error).message}`);
      recordFailure(sessionID);
      try { unlinkSync(tmpPath); } catch { /* noop */ }
      return;
    }

    const spawned = child;
    const tmpRef = tmpPath;

    const ttl = setTimeout(() => {
      try { spawned.kill(); } catch { /* noop */ }
      logError(sessionID, "Subprocess killed after TTL expiry (30s)");
    }, SUBPROCESS_TTL_MS);

    spawned.exited.then((exitCode) => {
      clearTimeout(ttl);

      if (exitCode === 0) {
        resetFailures(sessionID);
        displayLog("recorded");
        try { unlinkSync(tmpRef); } catch { /* noop */ }
        return;
      }

      let stderrText = "";
      try {
        stderrText = new TextDecoder().decode(spawned.stderr as AllowSharedBufferSource);
      } catch {
        stderrText = "<unable to read stderr>";
      }
      logError(sessionID, `Subprocess exited with code ${exitCode}: ${stderrText}`);
      recordFailure(sessionID);
      try { unlinkSync(tmpRef); } catch { /* noop */ }
    }).catch((err) => {
      clearTimeout(ttl);
      logError(sessionID, `Subprocess error: ${(err as Error).message}`);
      recordFailure(sessionID);
      try { unlinkSync(tmpRef); } catch { /* noop */ }
    });
  }

  const MIN_TURN_LENGTH = 200;

  async function runPipeline(sessionID: string): Promise<void> {
    if (isCircuitOpen(sessionID)) return;

    let result: { lastMessageID: string; turnText: string };
    try {
      result = await opts.fetchMessages(sessionID);
    } catch (err) {
      logError(sessionID, `fetchMessages failed: ${(err as Error).message}`);
      recordFailure(sessionID);
      return;
    }

    const turnText = result.turnText.trim();

    if (turnText.length < MIN_TURN_LENGTH) return;

    if (isDuplicate(sessionID, result.lastMessageID)) return;

    markProcessed(sessionID, result.lastMessageID);

    spawnSubprocess(sessionID, turnText);
  }

  function buildTurnText(messages: MessageEntry[]): string {
    const parts: string[] = [];
    for (const msg of messages) {
      for (const part of msg.parts) {
        if (part.text) parts.push(part.text);
      }
    }
    return parts.join("\n\n").trim();
  }

  const eventHandler = async (input: { event: { type: string; properties?: Record<string, unknown> } }): Promise<void> => {
    const sessionID = isIdleEvent(input);
    if (!sessionID) {
      if (input?.event?.type === "session.status" && (input.event.properties?.status as { type?: string })?.type === "busy") {
        clearDebounce();
      }
      return;
    }

    if (isCircuitOpen(sessionID)) return;

    scheduleDebounce(sessionID);
  };

  const hook = eventHandler as typeof eventHandler & {
    state: typeof state;
    isIdleEvent: typeof isIdleEvent;
    clearDebounce: typeof clearDebounce;
    scheduleDebounce: typeof scheduleDebounce;
    isCircuitOpen: typeof isCircuitOpen;
    recordFailure: typeof recordFailure;
    resetFailures: typeof resetFailures;
    isDuplicate: typeof isDuplicate;
    markProcessed: typeof markProcessed;
    displayLog: typeof displayLog;
    logError: typeof logError;
    buildCommand: typeof buildCommand;
    buildTurnText: typeof buildTurnText;
    spawnSubprocess: typeof spawnSubprocess;
    runPipeline: typeof runPipeline;
    opts: typeof opts;
    SUBPROCESS_TTL_MS: typeof SUBPROCESS_TTL_MS;
    onIdle: (sessionID: string) => void;
    onBusy: (sessionID: string) => void;
  };

  hook.state = state;
  hook.isIdleEvent = isIdleEvent;
  hook.clearDebounce = clearDebounce;
  hook.scheduleDebounce = scheduleDebounce;
  hook.isCircuitOpen = isCircuitOpen;
  hook.recordFailure = recordFailure;
  hook.resetFailures = resetFailures;
  hook.isDuplicate = isDuplicate;
  hook.markProcessed = markProcessed;
  hook.displayLog = displayLog;
  hook.logError = logError;
  hook.buildCommand = buildCommand;
  hook.buildTurnText = buildTurnText;
  hook.spawnSubprocess = spawnSubprocess;
  hook.runPipeline = runPipeline;
  hook.opts = opts;
  hook.SUBPROCESS_TTL_MS = SUBPROCESS_TTL_MS;
  hook.onIdle = scheduleDebounce;
  hook.onBusy = clearDebounce;

  return hook;
}
