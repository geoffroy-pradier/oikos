import { useCallback, useEffect, useState } from 'react';
import { adminGet } from './api';

/** Lit une route du back-office. `data` reste `null` tant que rien n'a été lu ; `error` porte le code du refus. */
export function useAdmin<T>(path: string, accessToken: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    const reply = await adminGet<T>(path, accessToken);
    setError(reply.ok ? null : reply.code);
    if (reply.ok) setData(reply.data);
  }, [path, accessToken]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, reload };
}
