/**
 * Local-state foundation — the single, versioned client store.
 *
 * Everything the reader accumulates on the site lives here, in ONE
 * `localStorage` key, behind a tiny `load()` / `save()` interface. Today that
 * is just completion progress; later phases layer their own slices onto the
 * same document (quiz-attempt history, a spaced-repetition schedule, per-note
 * scratchpads) WITHOUT adding more storage keys or more ad-hoc parsing.
 *
 * WHY A SINGLE STORE
 *   Every v2 feature reads and writes the same per-reader state. If each
 *   feature kept its own key and its own JSON handling, they would drift and
 *   duplicate the SSR guards, the change plumbing, and the export logic. One
 *   document keeps migrations, export/import, and "reset everything" trivial.
 *
 * WHY AN INTERFACE (`load` / `save`)
 *   Features never touch `localStorage` directly — they call `load()` to read
 *   the typed document and `save()` to persist a new one. If a sync backend is
 *   ever added, only this module changes; every feature on top is unaffected.
 *   That is the cheap insurance that lets us defer a backend indefinitely.
 *
 * SAFETY
 *   - SSR-safe: every `window` / `localStorage` access is guarded, so this can
 *     be imported from any island without breaking the static build.
 *   - Versioned: the document carries a `version`; {@link migrate} upgrades any
 *     older or unknown shape to the current one, so a reader's data survives
 *     schema changes instead of being silently dropped.
 *   - Fail-soft: a corrupt or unparseable value resets to a fresh document
 *     rather than throwing. State never leaves the browser.
 *   - Observable: {@link onStoreChange} fires on same-tab writes AND the
 *     browser's cross-tab `storage` event, so every open surface stays in sync.
 */

/** The single localStorage key that holds the entire store document. */
export const STORAGE_KEY = 'cortex:store';

/** DOM event dispatched on `window` on every same-tab {@link save}. */
export const STORE_CHANGE_EVENT = 'cortex:store-change';

/**
 * The legacy key used by the pre-v2 progress store (an array of routes). It is
 * read ONCE during migration so existing readers keep their completed topics,
 * then left in place (harmless) rather than deleted.
 */
const LEGACY_PROGRESS_KEY = 'cortex:progress';

/** Current schema version. Bump when {@link StoreDoc}'s shape changes. */
export const SCHEMA_VERSION = 3 as const;

/**
 * In-memory cache of the parsed document.
 *
 * WHY: every facade (`progress`, `review`, `scratchpad`, recall cards, …) calls
 * `load()` on each read, and surfaces read repeatedly within a single render.
 * Re-parsing the JSON every time is wasteful and gets worse as the document
 * grows with the note count. We parse once, keep the result here, and reuse it
 * until a write (this tab) or a cross-tab `storage` event invalidates it. The
 * cache is a private detail: callers see the same values, just faster.
 *
 * `null` means "not loaded / invalidated — parse from storage on next read".
 */
let cache: StoreDoc | null = null;

/**
 * A spaced-repetition review item for one note (Phase 2). Scheduling fields
 * follow an SM-2-lite model (see `@/lib/review`): the note resurfaces for
 * review once `due` passes, and the next interval grows or resets based on how
 * the reader did on that note's quiz. All times are epoch milliseconds.
 */
export interface ReviewItem {
  /** Epoch ms when this note is next due for review. */
  due: number;
  /** Current inter-review interval, in days. */
  intervalDays: number;
  /** Easiness factor (SM-2); higher = intervals grow faster. Clamped ≥ 1.3. */
  ease: number;
  /** Successful reviews in a row (resets to 0 on a lapse). */
  reps: number;
  /** Times this item has lapsed (failed after being learned). */
  lapses: number;
  /** Epoch ms of the last review, or 0 if never reviewed. */
  lastReviewed: number;
}

/**
 * A GRADED quiz attempt in progress for one note (Phase 3, "strict timer").
 *
 * The attempt is persisted so its clock is a real wall-clock deadline, not a
 * UI countdown. The deadline is fixed the instant the attempt starts and lives
 * here, independent of whether the dialog is open. Closing and reopening the
 * dialog resumes the SAME attempt against the SAME deadline, and if `deadline`
 * has already passed when the quiz is reopened, the attempt resolves as a
 * timeout rather than handing back time. This is the "you cannot pause the
 * clock by closing the quiz" rule. Flashcards practice is untimed and never
 * creates an attempt. All times are epoch milliseconds.
 */
export interface QuizAttempt {
  /** Epoch ms the attempt started (fixed; never moved). */
  startedAt: number;
  /** Epoch ms the attempt must finish by (fixed at start; never extended). */
  deadline: number;
  /**
   * Per-question outcome in authored order: `true` correct, `false` wrong,
   * `null` not yet answered. Length equals the note's question count.
   */
  answers: (boolean | null)[];
  /** Index of the question the reader is currently on. */
  index: number;
}

/**
 * The whole persisted document.
 *
 * Slices are intentionally independent maps/arrays so a later phase can add a
 * field without disturbing the others. `progress` is the only populated slice
 * in Phase 0; the rest are declared now so the shape (and migrations) are
 * stable as features land.
 */
export interface StoreDoc {
  /** Schema version this document was written at. */
  version: number;
  /** Completed note routes (normalized). The Phase 0 payload. */
  progress: string[];
  /**
   * Per-note freeform scratchpad text, keyed by note route. Added by Phase 1;
   * declared here so the schema is stable. Empty strings are pruned on save.
   */
  scratchpad: Record<string, string>;
  /**
   * Spaced-repetition schedule, keyed by note route. Added by Phase 2. A note
   * gains an entry the first time its quiz is completed; the scheduler in
   * `@/lib/review` reads and updates these.
   */
  review: Record<string, ReviewItem>;
  /**
   * In-progress graded quiz attempts, keyed by note route. Added by Phase 3.
   * An entry exists only while an attempt is live; it is cleared the moment the
   * attempt resolves (submitted, timed out, or abandoned). At most one attempt
   * per note.
   */
  attempts: Record<string, QuizAttempt>;
}

/** A fresh, empty document at the current version. */
function emptyDoc(): StoreDoc {
  return { version: SCHEMA_VERSION, progress: [], scratchpad: {}, review: {}, attempts: {} };
}

/**
 * A structural copy of a document, so the in-memory cache can never be mutated
 * by a caller holding a returned reference. Review items are plain data, so a
 * shallow-per-slice copy is sufficient and cheap.
 */
function cloneDoc(doc: StoreDoc): StoreDoc {
  const review: Record<string, ReviewItem> = {};
  for (const [k, v] of Object.entries(doc.review)) review[k] = { ...v };
  const attempts: Record<string, QuizAttempt> = {};
  for (const [k, v] of Object.entries(doc.attempts)) attempts[k] = { ...v, answers: [...v.answers] };
  return {
    version: doc.version,
    progress: [...doc.progress],
    scratchpad: { ...doc.scratchpad },
    review,
    attempts,
  };
}

/** Invalidate the in-memory cache (next read re-parses from storage). */
export function invalidateCache(): void {
  cache = null;
}

/** Guard: are we in a browser with a usable `localStorage`? */
function hasStorage(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    // Accessing localStorage can throw in sandboxed/blocked contexts.
    return false;
  }
}

/** True for a non-null, non-array object. */
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Coerce an unknown value into a string[] of just its string members. */
function toStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** Coerce an unknown value into a Record<string,string> (string values only). */
function toStringRecord(v: unknown): Record<string, string> {
  if (!isObject(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === 'string') out[k] = val;
  }
  return out;
}

/** A finite number, or `fallback` when the value is missing/invalid. */
function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * Coerce an unknown value into the review map, salvaging only well-formed
 * items. Each item's fields are read defensively with sane defaults, so a
 * partial or hand-edited entry still loads rather than dropping the whole slice.
 */
function toReviewRecord(v: unknown): Record<string, ReviewItem> {
  if (!isObject(v)) return {};
  const out: Record<string, ReviewItem> = {};
  for (const [k, raw] of Object.entries(v)) {
    if (!isObject(raw)) continue;
    out[k] = {
      due: num(raw.due, 0),
      intervalDays: num(raw.intervalDays, 0),
      ease: num(raw.ease, 2.5),
      reps: num(raw.reps, 0),
      lapses: num(raw.lapses, 0),
      lastReviewed: num(raw.lastReviewed, 0),
    };
  }
  return out;
}

/**
 * Coerce an unknown value into the attempts map, salvaging only well-formed
 * entries. An entry missing its timestamps is dropped, since a live attempt is
 * meaningless without a deadline. `answers` is read defensively, mapping any
 * non-boolean member to `null` (unanswered).
 */
function toAttemptRecord(v: unknown): Record<string, QuizAttempt> {
  if (!isObject(v)) return {};
  const out: Record<string, QuizAttempt> = {};
  for (const [k, raw] of Object.entries(v)) {
    if (!isObject(raw)) continue;
    const startedAt = num(raw.startedAt, 0);
    const deadline = num(raw.deadline, 0);
    if (startedAt <= 0 || deadline <= 0) continue; // not a usable live attempt
    const answers = Array.isArray(raw.answers)
      ? raw.answers.map((a) => (typeof a === 'boolean' ? a : null))
      : [];
    out[k] = { startedAt, deadline, answers, index: num(raw.index, 0) };
  }
  return out;
}

/**
 * One-time import of the pre-v2 progress key (`cortex:progress`, an array of
 * routes) when the new store does not exist yet. Returns the routes, or an
 * empty array if there is nothing to migrate.
 */
function readLegacyProgress(): string[] {
  if (!hasStorage()) return [];
  try {
    const raw = window.localStorage.getItem(LEGACY_PROGRESS_KEY);
    if (!raw) return [];
    return toStringArray(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

/**
 * Upgrade any raw parsed value to a current {@link StoreDoc}.
 *
 * Handles: a current-version doc (validated field by field), an older/unknown
 * object shape (fields salvaged where present), and anything else (treated as
 * absent). Unknown future versions are read leniently rather than discarded, so
 * a reader who downgrades the site does not lose data.
 */
export function migrate(raw: unknown): StoreDoc {
  if (!isObject(raw)) return emptyDoc();
  // Salvage each known slice regardless of the declared version. New versions
  // only ever ADD slices, so field-wise salvage upgrades any past shape.
  const doc: StoreDoc = {
    version: SCHEMA_VERSION,
    progress: toStringArray(raw.progress),
    scratchpad: toStringRecord(raw.scratchpad),
    review: toReviewRecord(raw.review),
    attempts: toAttemptRecord(raw.attempts),
  };
  return doc;
}

/**
 * Read the full typed document from storage.
 *
 * On first run (no store key) it seeds from the legacy progress key so existing
 * readers keep their completed topics. Any failure yields a fresh empty doc.
 */
export function load(): StoreDoc {
  // Serve from the in-memory cache when warm (returns a copy, see cloneDoc).
  if (cache !== null) return cloneDoc(cache);
  if (!hasStorage()) return emptyDoc();
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return emptyDoc();
  }
  if (raw === null) {
    // No v2 store yet: migrate the legacy progress array (if any) in place.
    const legacy = readLegacyProgress();
    const doc = emptyDoc();
    doc.progress = legacy;
    if (legacy.length > 0) save(doc); // persist the upgrade once (also warms cache)
    cache = cloneDoc(doc);
    return doc;
  }
  let doc: StoreDoc;
  try {
    doc = migrate(JSON.parse(raw) as unknown);
  } catch {
    return emptyDoc();
  }
  cache = cloneDoc(doc);
  return doc;
}

/**
 * Persist a document and notify this tab's listeners.
 *
 * The document is normalized before writing (version stamped, empty scratchpad
 * entries pruned) so storage never accumulates junk. A write failure (quota,
 * private mode) is swallowed: the change simply does not outlive the session.
 */
export function save(doc: StoreDoc): void {
  if (!hasStorage()) return;
  const clean: StoreDoc = {
    version: SCHEMA_VERSION,
    progress: [...new Set(doc.progress)],
    scratchpad: Object.fromEntries(
      Object.entries(doc.scratchpad).filter(([, v]) => v.trim() !== ''),
    ),
    review: doc.review,
    attempts: doc.attempts,
  };
  // Refresh the in-memory cache so subsequent reads in this tab are instant and
  // consistent with what we just wrote, even if persistence below fails.
  cache = cloneDoc(clean);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
  } catch {
    // Quota or private mode: non-fatal.
  }
  // The native `storage` event only fires in OTHER tabs, so dispatch our own
  // for THIS tab; `onStoreChange` listens to both.
  try {
    window.dispatchEvent(new CustomEvent(STORE_CHANGE_EVENT));
  } catch {
    // Environments without CustomEvent: listeners just won't fire same-tab.
  }
}

/**
 * Read-modify-write helper: apply `fn` to the current document and persist the
 * result. Keeps every mutation a single atomic load→change→save.
 */
export function update(fn: (doc: StoreDoc) => StoreDoc): StoreDoc {
  const next = fn(load());
  save(next);
  return next;
}

/**
 * Subscribe to any change, in this tab or another. Fires on the same-tab
 * {@link STORE_CHANGE_EVENT} and the cross-tab `storage` event (filtered to our
 * key). Returns an unsubscribe function.
 */
export function onStoreChange(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const sameTab = (): void => listener();
  const crossTab = (e: StorageEvent): void => {
    if (e.key === STORAGE_KEY || e.key === null) {
      // Another tab changed the document: drop our cache so the next read
      // reflects their write, then notify.
      invalidateCache();
      listener();
    }
  };
  window.addEventListener(STORE_CHANGE_EVENT, sameTab);
  window.addEventListener('storage', crossTab);
  return () => {
    window.removeEventListener(STORE_CHANGE_EVENT, sameTab);
    window.removeEventListener('storage', crossTab);
  };
}

/* ===========================================================================
 * Export / import — the escape hatch that makes deferring a backend safe.
 * A reader can download their whole state as JSON and restore it on another
 * browser or after clearing data, so nothing is ever trapped in one device.
 * =========================================================================== */

/** Serialize the current document to a pretty JSON string for download. */
export function exportJSON(): string {
  return JSON.stringify(load(), null, 2);
}

/**
 * Replace the store from a JSON string (as produced by {@link exportJSON}).
 * The input is migrated like any stored value, so a partial or older export
 * still imports cleanly. Returns `true` on success, `false` if the text could
 * not be parsed (the current store is left untouched on failure).
 */
export function importJSON(json: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return false;
  }
  save(migrate(parsed));
  return true;
}

/** Wipe the entire store back to an empty document. */
export function clearAll(): void {
  save(emptyDoc());
}
