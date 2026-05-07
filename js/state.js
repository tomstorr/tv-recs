// In-memory state and mutation orchestration.
//
// READ-2, READ-5
// WRITE-1, WRITE-3, WRITE-4, WRITE-5, WRITE-6
// STATE-1, STATE-2, STATE-3, STATE-4
// LIFECYCLE-2, LIFECYCLE-3, LIFECYCLE-4
// AUTH-5

import * as drive from "./drive.js";

const TOP_KEYS = ["watched", "watchlist", "recommended", "tasteProfile"];
const ARRAY_KEYS = new Set(["watched", "watchlist", "recommended"]);

const internal = {
  data: null,                // canonical in-memory copy. null = not yet loaded.  READ-2
  missingKeys: new Set(),    // top-level keys absent from the file. READ-5
  lastSyncedAt: null,        // STATE-4
  isWriting: false,          // STATE-3
  authError: false,          // AUTH-5
  fetchError: null,          // READ-3, READ-4
  writeError: null,          // WRITE-5
};

const writeQueue = [];
let queueRunning = false;
const listeners = new Set();

function emit() {
  for (const fn of listeners) {
    try { fn(); } catch (e) { console.error("state listener threw:", e); }
  }
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// STATE-1
export function getState() {
  return {
    data: internal.data,
    missingKeys: new Set(internal.missingKeys),
    lastSyncedAt: internal.lastSyncedAt, // STATE-4
    isWriting: internal.isWriting,       // STATE-3
    authError: internal.authError,       // AUTH-5
    fetchError: internal.fetchError,     // READ-3, READ-4
    writeError: internal.writeError,     // WRITE-5
  };
}

function deepClone(x) {
  return JSON.parse(JSON.stringify(x));
}

// READ-5: missing top-level keys are filled with empty arrays/objects in
// memory, but tracked separately so write paths can decide whether to
// include them or not. The original file is left intact.
function normaliseTopLevel(raw) {
  const out = {};
  const missing = new Set();
  for (const k of TOP_KEYS) {
    if (Object.prototype.hasOwnProperty.call(raw, k)) {
      out[k] = raw[k];
    } else {
      missing.add(k);
      out[k] = ARRAY_KEYS.has(k) ? [] : {};
    }
  }
  // Preserve any non-canonical keys (e.g. a "_comment") so we don't drop them.
  for (const k of Object.keys(raw)) {
    if (!(k in out)) out[k] = raw[k];
  }
  return { data: out, missing };
}

export async function initialLoad() {
  // LIFECYCLE-1 (loading state) is rendered by the caller; this just performs
  // the fetch and updates state.
  internal.fetchError = null;
  emit();
  try {
    const raw = await drive.readFile(); // READ-1
    const { data, missing } = normaliseTopLevel(raw);
    internal.data = data;          // READ-2
    internal.missingKeys = missing; // READ-5
    internal.lastSyncedAt = Date.now(); // STATE-4
    emit();
  } catch (e) {
    if (e.kind === "fileNotAccessible") {
      // Caller (app.js) shows the Picker prompt; don't pollute state flags.
      throw e;
    }
    if (e.kind === "auth") {
      internal.authError = true; // AUTH-5
    } else {
      internal.fetchError = e;   // READ-3, READ-4
    }
    emit();
    throw e;
  }
}

// LIFECYCLE-4
export async function refresh() {
  return initialLoad();
}

// STATE-2: every named mutator delegates here.
// STATE-3: writes are queued so they don't race.
// WRITE-1, WRITE-3, WRITE-4, WRITE-5, WRITE-6 all flow through this path.
export function runMutation(name, applyFn) {
  return new Promise((resolve, reject) => {
    writeQueue.push({ name, applyFn, resolve, reject });
    runQueue();
  });
}

async function runQueue() {
  if (queueRunning) return;
  queueRunning = true;
  while (writeQueue.length > 0) {
    const job = writeQueue.shift();
    await runJob(job);
  }
  queueRunning = false;
}

async function runJob(job) {
  const { name, applyFn, resolve, reject } = job;
  if (!internal.data) {
    reject(new Error(`Mutation '${name}' attempted before initial load`));
    return;
  }

  // Snapshot for revert (WRITE-5).
  const preMutation = deepClone(internal.data);

  // Optimistic in-memory update so the UI reacts immediately. The
  // authoritative write happens against a fresh refetch (WRITE-1).
  let optimistic;
  try {
    optimistic = applyFn(deepClone(internal.data));
  } catch (e) {
    reject(e);
    return;
  }
  if (optimistic === undefined) {
    reject(new Error(`Mutation '${name}' returned undefined`));
    return;
  }
  internal.data = optimistic;
  internal.isWriting = true;  // STATE-3
  internal.writeError = null;
  emit();

  try {
    await performWriteWithRetry(name, applyFn);
    internal.isWriting = false;        // STATE-3
    internal.lastSyncedAt = Date.now(); // STATE-4
    emit();
    resolve();
  } catch (e) {
    internal.data = preMutation; // WRITE-5: revert optimistic update
    internal.isWriting = false;
    if (e.kind === "auth") {
      internal.authError = true; // AUTH-5
    } else {
      internal.writeError = e;   // WRITE-5
    }
    emit();
    reject(e);
  }
}

async function performWriteWithRetry(name, applyFn) {
  try {
    await performWriteOnce(name, applyFn);
  } catch (e) {
    if (e.kind === "auth") throw e;                 // do not retry auth errors
    if (e.kind === "tasteProfileTouched") throw e;  // do not retry programmer errors
    // WRITE-5: one retry after 1s.
    await new Promise((r) => setTimeout(r, 1000));
    await performWriteOnce(name, applyFn);
  }
}

async function performWriteOnce(name, applyFn) {
  // WRITE-1: refetch the latest file before applying the user's change.
  // LIFECYCLE-2: this is what makes scheduled-task collisions safe.
  const fresh = await drive.readFile();
  const { data: freshData } = normaliseTopLevel(fresh);

  // WRITE-4: snapshot tasteProfile *before* applying, then verify it is
  // unchanged after applying.
  const beforeTaste = JSON.stringify(freshData.tasteProfile ?? null);

  const updated = applyFn(deepClone(freshData)); // WRITE-3: applyFn touches only its targets
  if (updated === undefined) {
    throw new Error(`Mutation '${name}' returned undefined on refetch`);
  }

  const afterTaste = JSON.stringify(updated.tasteProfile ?? null);
  if (beforeTaste !== afterTaste) {
    // WRITE-4: never modify tasteProfile. Block the write and log.
    const err = new Error(`Mutation '${name}' would modify tasteProfile — blocked.`);
    err.kind = "tasteProfileTouched";
    console.error(err);
    throw err;
  }

  await drive.writeFile(updated); // WRITE-2 / WRITE-3
  internal.data = updated;        // WRITE-6: in-memory matches what was just written
}

// AUTH-5: cleared by the caller when the user reconnects.
export function clearAuthError() {
  internal.authError = false;
  emit();
}

// READ-3 / READ-4: cleared by the caller before a Retry attempt.
export function clearFetchError() {
  internal.fetchError = null;
  emit();
}

// WRITE-5: cleared by the caller after dismissing the toast.
export function clearWriteError() {
  internal.writeError = null;
  emit();
}

// On user sign-out (AUTH-6) we drop in-memory state so the next user
// (which is just the same user reconnecting) starts fresh.
export function reset() {
  internal.data = null;
  internal.missingKeys = new Set();
  internal.lastSyncedAt = null;
  internal.isWriting = false;
  internal.authError = false;
  internal.fetchError = null;
  internal.writeError = null;
  // Note: writeQueue is intentionally NOT cleared — a queued write is the
  // user's intent and should still complete. In practice sign-out is a
  // user-driven path so the queue is empty by then.
  emit();
}
