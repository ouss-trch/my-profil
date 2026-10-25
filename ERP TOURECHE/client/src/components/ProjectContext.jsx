import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setApiProject, setUnauthorizedHandler } from '../lib/api.js';

/** الجلسة + المشاريع + البيانات المرجعية (الولايات، الحالات، الشركات) */
const Ctx = createContext(null);

export function AppProvider({ children }) {
  const [auth, setAuth] = useState({ loading: true, user: null, setupRequired: false });
  const [projects, setProjects] = useState([]);
  const [meta, setMeta] = useState(null);
  const [project, setProjectState] = useState(() => {
    try {
      return localStorage.getItem('erp.project') || 'all';
    } catch {
      return 'all';
    }
  });
  setApiProject(project);

  const refreshAuth = useCallback(async () => {
    try {
      const s = await api.get('/auth/status', { project: null });
      setAuth({ loading: false, user: s.user, setupRequired: s.setup_required });
      return s;
    } catch {
      setAuth({ loading: false, user: null, setupRequired: false, offline: true });
      return null;
    }
  }, []);

  const loadProjects = useCallback(async () => {
    const [p, m] = await Promise.all([api.get('/projects', { project: null }), api.get('/meta', { project: null })]);
    setProjects(p);
    setMeta(m);
    return p;
  }, []);

  useEffect(() => {
    refreshAuth();
    setUnauthorizedHandler(() => setAuth((a) => ({ ...a, user: null })));
  }, [refreshAuth]);

  useEffect(() => {
    if (auth.user) loadProjects().catch(() => {});
  }, [auth.user, loadProjects]);

  // مشروع محذوف أو غير موجود → «كل المشاريع»
  useEffect(() => {
    if (projects.length && project !== 'all' && !projects.some((p) => String(p.id) === String(project))) setProject('all');
    if (projects.length === 1 && project === 'all') setProject(String(projects[0].id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects]);

  const setProject = useCallback((p) => {
    const v = String(p || 'all');
    setApiProject(v);
    setProjectState(v);
    try {
      localStorage.setItem('erp.project', v);
    } catch {
      /* */
    }
  }, []);

  const value = useMemo(() => {
    const current = project === 'all' ? null : projects.find((p) => String(p.id) === String(project)) || null;
    const wilayaName = (code, lang = 'ar') => {
      const w = meta?.wilayas?.find((x) => Number(x.code) === Number(code));
      return w ? `${w.code} - ${lang === 'ar' ? w.ar : w.fr}` : code ? String(code) : '—';
    };
    return { auth, refreshAuth, projects, loadProjects, project, setProject, current, meta, wilayaName, isAll: project === 'all' };
  }, [auth, refreshAuth, projects, loadProjects, project, setProject, meta]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useApp = () => useContext(Ctx);
export const useProject = () => {
  const c = useContext(Ctx);
  return { project: c.project, setProject: c.setProject, current: c.current, projects: c.projects, isAll: c.isAll };
};
