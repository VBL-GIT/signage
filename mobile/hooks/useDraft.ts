import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { readDraft, writeDraft, deleteDraft } from '../utils/drafts';

interface Options<T> {
  /** Hold off hydrating until the data a restore depends on (e.g. the task) has loaded. */
  enabled?: boolean;
  /** Apply a stored draft to component state. May be async (e.g. to check photo files still exist). */
  onRestore: (draft: T) => void | Promise<void>;
  /** An untouched form is not worth a draft: skips creating one. */
  isEmpty?: (value: T) => boolean;
}

const SAVE_DELAY_MS = 500;

/**
 * Autosaves `value` to disk (debounced, and flushed when the app is backgrounded
 * or the screen unmounts) and restores it on the next visit — surviving an app
 * kill, crash or lost connection.
 *
 * Callers should not render the form until `hydrated` is true, so inputs mount
 * with the restored values rather than the defaults.
 */
export function useDraft<T>(key: string | null, value: T, opts: Options<T>) {
  const [hydrated, setHydrated] = useState(false);
  const [restoredAt, setRestoredAt] = useState<number | null>(null);

  const valueRef = useRef(value);
  valueRef.current = value;
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const dead = useRef(false); // set after clear/discard so a late flush cannot resurrect the draft

  const enabled = opts.enabled !== false;

  useEffect(() => {
    if (!key || !enabled || hydrated) return;
    let cancelled = false;
    (async () => {
      const stored = await readDraft<T>(key);
      if (cancelled) return;
      if (stored) {
        try {
          await optsRef.current.onRestore(stored.data);
          if (!cancelled) setRestoredAt(stored.savedAt);
        } catch { /* a draft that no longer fits is simply ignored */ }
      }
      if (!cancelled) setHydrated(true);
    })();
    return () => { cancelled = true; };
  }, [key, enabled, hydrated]);

  const flush = useCallback(() => {
    if (!key || dead.current) return;
    const v = valueRef.current;
    if (optsRef.current.isEmpty?.(v)) return;
    void writeDraft(key, v);
  }, [key]);

  // Debounced autosave on every change once hydrated.
  useEffect(() => {
    if (!hydrated || !key) return;
    const t = setTimeout(flush, SAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [value, hydrated, key, flush]);

  // Flush immediately when the app goes to the background (the last moment we are
  // guaranteed to run before an OS kill) and when the screen goes away.
  useEffect(() => {
    if (!hydrated) return;
    const sub = AppState.addEventListener('change', (s) => { if (s !== 'active') flush(); });
    return () => { sub.remove(); flush(); };
  }, [hydrated, flush]);

  /** Call after a successful submit: removes the draft and its photos. */
  const clear = useCallback(async () => {
    dead.current = true;
    if (key) await deleteDraft(key);
  }, [key]);

  return { hydrated, restoredAt, clear };
}
