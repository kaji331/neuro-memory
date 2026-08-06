import { describe, it, expect } from "bun:test";
import { createRecordingHook, type RecordingOptions } from "../../opencode-neuro-memory-plugin/recording";

function idleEvent(sessionID: string) {
  return {
    event: { type: "session.status" as const, properties: { sessionID, status: { type: "idle" as const } } },
  };
}

function busyEvent(sessionID: string) {
  return {
    event: { type: "session.status" as const, properties: { sessionID, status: { type: "busy" as const } } },
  };
}

function retryEvent(sessionID: string) {
  return {
    event: { type: "session.status" as const, properties: { sessionID, status: { type: "retry" as const, attempt: 1, message: "retry", next: 2000 } } },
  };
}

function legacyIdleEvent(sessionID: string) {
  return { event: { type: "session.idle" as const, properties: { sessionID } } };
}

function otherEvent() {
  return { event: { type: "message.updated" as const, properties: {} } };
}

function defaults(overrides: Partial<RecordingOptions> = {}): RecordingOptions {
  return {
    display: false,
    dbPath: ":memory:",
    configPath: "/tmp/neuro-memory.yaml",
    cliPath: "src/cli.ts",
    errorsLogPath: "/tmp/neuro-memory-errors.log",
    ...overrides,
  };
}

describe("createRecordingHook — idle filtering", () => {
  it("returns sessionID for session.status idle", () => {
    const hook = createRecordingHook(defaults());
    expect((hook as any).isIdleEvent(idleEvent("s1"))).toBe("s1");
  });

  it("returns sessionID for session.idle (deprecated)", () => {
    const hook = createRecordingHook(defaults());
    expect((hook as any).isIdleEvent(legacyIdleEvent("s1"))).toBe("s1");
  });

  it("returns null for session.status busy", () => {
    const hook = createRecordingHook(defaults());
    expect((hook as any).isIdleEvent(busyEvent("s1"))).toBeNull();
  });

  it("returns null for session.status retry", () => {
    const hook = createRecordingHook(defaults());
    expect((hook as any).isIdleEvent(retryEvent("s1"))).toBeNull();
  });

  it("returns null for other event types", () => {
    const hook = createRecordingHook(defaults());
    expect((hook as any).isIdleEvent(otherEvent())).toBeNull();
  });

  it("returns null for null/missing event or properties", () => {
    const hook = createRecordingHook(defaults());
    expect((hook as any).isIdleEvent({ event: null as any } as any)).toBeNull();
    expect((hook as any).isIdleEvent({ event: { type: "session.status", properties: null as any } } as any)).toBeNull();
    expect((hook as any).isIdleEvent({ event: { type: "session.status" } as any })).toBeNull();
  });
});

describe("createRecordingHook — debounce", () => {
  it("sets debounceSessionID and a timer on idle", () => {
    const hook = createRecordingHook(defaults());
    (hook as any).onIdle("s1");
    expect((hook as any).state.debounceSessionID).toBe("s1");
    expect((hook as any).state.debounceTimer).not.toBeNull();
    clearTimeout((hook as any).state.debounceTimer);
  });

  it("clears debounceSessionID and nullifies timer on busy", () => {
    const hook = createRecordingHook(defaults());
    (hook as any).state.debounceTimer = setTimeout(() => {}, 9999) as any;
    (hook as any).state.debounceSessionID = "s1";

    (hook as any).onBusy("s1");
    expect((hook as any).state.debounceTimer).toBeNull();
    expect((hook as any).state.debounceSessionID).toBeNull();
  });
});

describe("createRecordingHook — idempotency", () => {
  it("skips same session+msgID within 30s", () => {
    const hook = createRecordingHook(defaults());
    (hook as any).state.lastProcessed.set("s1", { lastMessageID: "msg-a", timestamp: Date.now() });
    expect((hook as any).isDuplicate("s1", "msg-a")).toBe(true);
  });

  it("allows different msgID in same session", () => {
    const hook = createRecordingHook(defaults());
    (hook as any).state.lastProcessed.set("s1", { lastMessageID: "msg-a", timestamp: Date.now() });
    expect((hook as any).isDuplicate("s1", "msg-b")).toBe(false);
  });

  it("allows different session with same msgID", () => {
    const hook = createRecordingHook(defaults());
    (hook as any).state.lastProcessed.set("s1", { lastMessageID: "msg-a", timestamp: Date.now() });
    expect((hook as any).isDuplicate("s2", "msg-a")).toBe(false);
  });

  it("allows re-process after 30s for same session+msgID", () => {
    const hook = createRecordingHook(defaults());
    (hook as any).state.lastProcessed.set("s1", { lastMessageID: "msg-a", timestamp: Date.now() - 31000 });
    expect((hook as any).isDuplicate("s1", "msg-a")).toBe(false);
  });

  it("updates state after successful processing", () => {
    const hook = createRecordingHook(defaults());
    (hook as any).markProcessed("sX", "msgFinal");
    expect((hook as any).state.lastProcessed.get("sX").lastMessageID).toBe("msgFinal");
  });
});

describe("createRecordingHook — circuit breaker", () => {
  it("starts at 0 failures", () => {
    const hook = createRecordingHook(defaults());
    expect((hook as any).state.failureCount.get("s1") ?? 0).toBe(0);
  });

  it("increments failure count", () => {
    const hook = createRecordingHook(defaults());
    (hook as any).recordFailure("s1");
    (hook as any).recordFailure("s1");
    expect((hook as any).state.failureCount.get("s1")).toBe(2);
  });

  it("opens circuit at 3 failures", () => {
    const hook = createRecordingHook(defaults());
    (hook as any).recordFailure("s1");
    (hook as any).recordFailure("s1");
    (hook as any).recordFailure("s1");
    expect((hook as any).isCircuitOpen("s1")).toBe(true);
  });

  it("does not open before 3 failures", () => {
    const hook = createRecordingHook(defaults());
    (hook as any).recordFailure("s1");
    (hook as any).recordFailure("s1");
    expect((hook as any).isCircuitOpen("s1")).toBe(false);
  });

  it("resets failure count on success", () => {
    const hook = createRecordingHook(defaults());
    (hook as any).recordFailure("s1");
    (hook as any).recordFailure("s1");
    (hook as any).resetFailures("s1");
    expect((hook as any).state.failureCount.get("s1")).toBe(0);
  });

  it("does not share breaker state across sessions", () => {
    const hook = createRecordingHook(defaults());
    (hook as any).recordFailure("s1");
    (hook as any).recordFailure("s1");
    (hook as any).recordFailure("s1");
    expect((hook as any).isCircuitOpen("s1")).toBe(true);
    expect((hook as any).isCircuitOpen("s2")).toBe(false);
  });
});

describe("createRecordingHook — display", () => {
  it("display:false produces no console output", () => {
    const original = console.log;
    let logged = false;
    console.log = () => { logged = true; };
    try {
      const hook = createRecordingHook(defaults({ display: false }));
      (hook as any).displayLog("recorded");
      expect(logged).toBe(false);
    } finally {
      console.log = original;
    }
  });

  it("display:true emits [neuro-memory] prefix", () => {
    const original = console.log;
    let output = "";
    console.log = (msg: string) => { output = msg; };
    try {
      const hook = createRecordingHook(defaults({ display: true }));
      (hook as any).displayLog("recorded");
      expect(output).toContain("[neuro-memory]");
      expect(output).toContain("recorded");
    } finally {
      console.log = original;
    }
  });
});

describe("createRecordingHook — errors log", () => {
  it("stores errorsLogPath from options", () => {
    const hook = createRecordingHook(defaults({ errorsLogPath: "/tmp/custom-errors.log" }));
    expect((hook as any).opts.errorsLogPath).toBe("/tmp/custom-errors.log");
  });

  it("appends error text to configured file", async () => {
    const { existsSync, unlinkSync, readFileSync } = await import("fs");
    const logPath = "/tmp/neuro-recording-errors-test.log";
    if (existsSync(logPath)) unlinkSync(logPath);

    const hook = createRecordingHook(defaults({ errorsLogPath: logPath }));
    (hook as any).logError("s1", "test error message");

    const content = readFileSync(logPath, "utf-8");
    expect(content).toContain("test error message");
    if (existsSync(logPath)) unlinkSync(logPath);
  });
});

describe("createRecordingHook — detached spawn + TTL", () => {
  it("SUBPROCESS_TTL_MS is 30000", () => {
    const hook = createRecordingHook(defaults());
    expect((hook as any).SUBPROCESS_TTL_MS).toBe(30000);
  });

  it("buildCommand includes --input-file and --config flags", () => {
    const hook = createRecordingHook(defaults({ cliPath: "bun", configPath: "/cfg.yaml" }));
    const cmd = (hook as any).buildCommand("/tmp/turn.txt");
    expect(cmd.includes("bun")).toBe(true);
    expect(cmd.includes("summarize")).toBe(true);
    expect(cmd.includes("--input-file")).toBe(true);
    expect(cmd.includes("/tmp/turn.txt")).toBe(true);
    expect(cmd.includes("--config")).toBe(true);
    expect(cmd.includes("/cfg.yaml")).toBe(true);
  });
});

// ─── WIRED PIPELINE TESTS (TDD) ──────────────────────────────────────

describe("createRecordingHook — wired pipeline (event → debounce → record)", () => {
  const MIN_TURN_TEXT = "A".repeat(200);

  function makeMessages(override: { lastMessageID?: string; text?: string } = {}) {
    const text = override.text ?? MIN_TURN_TEXT;
    const lastMessageID = override.lastMessageID ?? "msg-last";
    return { lastMessageID, turnText: text };
  }

  function createPipe(opts?: Partial<RecordingOptions>) {
    let fetchFn: (sessionID: string) => Promise<{ lastMessageID: string; turnText: string }> =
      (sid) => Promise.resolve(makeMessages({ lastMessageID: `msg-${sid}`, text: MIN_TURN_TEXT }));

    const hook = createRecordingHook({
      ...defaults(opts),
      fetchMessages: (sessionID: string) => fetchFn(sessionID),
    } as RecordingOptions);

    const runPipeline = (hook as any).runPipeline as (sid: string) => Promise<void>;

    return {
      hook,
      runPipeline,
      setFetch: (fn: typeof fetchFn) => { fetchFn = fn; },
      markProcessed: (sid: string, msgId: string) => (hook as any).markProcessed(sid, msgId),
      isDuplicate: (sid: string, msgId: string) => (hook as any).isDuplicate(sid, msgId),
      isCircuitOpen: (sid: string) => (hook as any).isCircuitOpen(sid),
      recordFailure: (sid: string) => (hook as any).recordFailure(sid),
      resetFailures: (sid: string) => (hook as any).resetFailures(sid),
      getFailureCount: (sid: string) => (hook as any).state.failureCount.get(sid) ?? 0,
      getDebounceTimer: () => (hook as any).state.debounceTimer,
      getDebounceSessionID: () => (hook as any).state.debounceSessionID,
      fire: (event: any) => (hook as any)(event),
    };
  }

  it("runPipeline → fetchMessages → buildTurnText → check threshold → check duplicate → markProcessed → spawnSubprocess", async () => {
    const { hook, runPipeline, isDuplicate } = createPipe();

    await runPipeline("s-full");

    expect(isDuplicate("s-full", "msg-s-full")).toBe(true);
  });

  it("circuit-open session → runPipeline does nothing", async () => {
    const { hook, runPipeline, recordFailure, isCircuitOpen, markProcessed } = createPipe();

    recordFailure("s-cb");
    recordFailure("s-cb");
    recordFailure("s-cb");
    expect(isCircuitOpen("s-cb")).toBe(true);

    await runPipeline("s-cb");

    expect((hook as any).state.lastProcessed.has("s-cb")).toBe(false);
  });

  it("duplicate (same sessionID+lastMessageID within 30s) → no re-spawn", async () => {
    const { hook, runPipeline, markProcessed, setFetch } = createPipe();

    markProcessed("s-dup", "msg-dup");
    setFetch(() => Promise.resolve({ lastMessageID: "msg-dup", turnText: MIN_TURN_TEXT }));

    await runPipeline("s-dup");

    expect((hook as any).state.lastProcessed.get("s-dup").lastMessageID).toBe("msg-dup");
  });

  it("different lastMessageID in same session → spawn fires", async () => {
    const { runPipeline, markProcessed, isDuplicate } = createPipe();

    markProcessed("s-diff", "msg-old");
    await runPipeline("s-diff"); // fetchMessages returns msg-s-diff

    expect(isDuplicate("s-diff", "msg-s-diff")).toBe(true);
  });

  it("duplicate after 30s expiry → re-spawns", async () => {
    const { hook, runPipeline, isDuplicate } = createPipe();

    (hook as any).state.lastProcessed.set("s-expiry", {
      lastMessageID: "msg-s-expiry",
      timestamp: Date.now() - 31000,
    });

    await runPipeline("s-expiry");
    expect(isDuplicate("s-expiry", "msg-s-expiry")).toBe(true);
  });

  it("<200 char turn text → no spawn", async () => {
    const { runPipeline, setFetch, isDuplicate } = createPipe();

    setFetch(() => Promise.resolve({ lastMessageID: "msg-short", turnText: "too short" }));

    await runPipeline("s-short");
    expect(isDuplicate("s-short", "msg-short")).toBe(false);
  });

  it("fetchMessages error → logError + recordFailure, no crash", async () => {
    const { runPipeline, setFetch, getFailureCount } = createPipe();

    setFetch(() => Promise.reject(new Error("fetch failed")));

    await runPipeline("s-err");

    expect(getFailureCount("s-err")).toBe(1);
  });

  it("eventHandler gates on circuit-open before scheduling debounce", async () => {
    const { fire, recordFailure, getDebounceTimer, getDebounceSessionID } = createPipe();

    recordFailure("s-cbgate");
    recordFailure("s-cbgate");
    recordFailure("s-cbgate");

    await fire(idleEvent("s-cbgate"));

    expect(getDebounceTimer()).toBeNull();
    expect(getDebounceSessionID()).toBeNull();
  });

  it("eventHandler passes through busy-event cancellation correctly", async () => {
    const { fire, getDebounceTimer } = createPipe();

    await fire(idleEvent("s-busy"));
    expect(getDebounceTimer()).not.toBeNull();

    await fire(busyEvent("s-busy"));
    expect(getDebounceTimer()).toBeNull();
  });

  it("buildTurnText concatenates message parts into text", () => {
    const hook = createRecordingHook(defaults() as RecordingOptions);
    const messages = [
      { info: { id: "m1" }, parts: [{ text: "Hello" }, { text: "World" }] },
      { info: { id: "m2" }, parts: [{ text: "Foo bar" }] },
    ];
    const text = (hook as any).buildTurnText(messages);
    expect(text).toBe("Hello\n\nWorld\n\nFoo bar");
  });
});
