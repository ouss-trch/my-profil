import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { useProject } from '../components/ProjectContext.jsx';

/** جلب بيانات مع حالة التحميل والخطأ وإعادة التحميل؛ يتجدد تلقائياً عند تغيير المشروع */
export function useApi(path, { deps = [], skip = false, interval = 0 } = {}) {
  const { project } = useProject();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(!skip && Boolean(path));
  const ctrl = useRef(null);

  const load = useCallback(
    async (silent = false) => {
      if (skip || !path) return;
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      if (!silent) setLoading(true);
      try {
        const d = await api.get(path, { signal: c.signal });
        if (!c.signal.aborted) {
          setData(d);
          setError(null);
        }
      } catch (e) {
        if (e.name !== 'AbortError' && !c.signal.aborted) setError(e);
      } finally {
        if (!c.signal.aborted) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path, skip, project, ...deps],
  );

  useEffect(() => {
    load();
    return () => ctrl.current?.abort();
  }, [load]);

  useEffect(() => {
    if (!interval) return undefined;
    const id = setInterval(() => document.visibilityState === 'visible' && load(true), interval);
    return () => clearInterval(id);
  }, [interval, load]);

  return { data, error, loading, reload: load, setData };
}

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function useLocalStorage(key, initial) {
  const [v, setV] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : JSON.parse(raw);
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next) =>
      setV((cur) => {
        const val = typeof next === 'function' ? next(cur) : next;
        try {
          localStorage.setItem(key, JSON.stringify(val));
        } catch {
          /* التخزين غير متاح */
        }
        return val;
      }),
    [key],
  );
  return [v, set];
}
