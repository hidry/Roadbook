/**
 * Runs a best-effort sync cycle when the app becomes active. Errors (e.g. no
 * network, backend not configured) are swallowed by design — the app stays fully
 * usable offline against local SQLite (README §5.4).
 */
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { syncNow } from '@/lib/sync/syncEngine';

export function useBackgroundSync(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    const run = () => {
      syncNow().catch((e) => console.warn('[sync] skipped:', e instanceof Error ? e.message : e));
    };

    run(); // initial cycle on mount
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') run();
    });
    return () => sub.remove();
  }, [enabled]);
}
