import { useCallback, useEffect, useRef } from 'react';

export const DEFAULT_THROTTLE_MS = 120;

/**
 * Trailing-edge throttle for slider drags.
 *
 * The first call in a burst fires immediately so the UI feels responsive; further
 * calls within `delayMs` are collapsed into a single trailing call carrying the
 * most recent value, so the final position of a drag is always transmitted.
 */
export function useThrottledCallback<T>(
  callback: (value: T) => void,
  delayMs: number = DEFAULT_THROTTLE_MS,
): (value: T) => void {
  const callbackRef = useRef(callback);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRunRef = useRef(0);
  const pendingRef = useRef<{ value: T } | null>(null);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const flush = useCallback(() => {
    timerRef.current = null;
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    lastRunRef.current = Date.now();
    callbackRef.current(pending.value);
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const pending = pendingRef.current;
      if (pending) {
        pendingRef.current = null;
        callbackRef.current(pending.value);
      }
    },
    [],
  );

  return useCallback(
    (value: T) => {
      const now = Date.now();
      const elapsed = now - lastRunRef.current;

      if (timerRef.current === null && elapsed >= delayMs) {
        lastRunRef.current = now;
        callbackRef.current(value);
        return;
      }

      pendingRef.current = { value };
      timerRef.current ??= setTimeout(flush, Math.max(0, delayMs - elapsed));
    },
    [delayMs, flush],
  );
}
