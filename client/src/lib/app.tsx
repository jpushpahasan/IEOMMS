import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, onApiStatus } from './api';

export type Opt = { value: string; label: string; tone?: string };
export type RefOpt = { id: number; label: string; is_active: boolean; [k: string]: any };
export interface User {
  id: number; username: string; full_name: string; email: string | null; role: string; role_name: string;
  department_id: number | null; must_change_password: boolean; permissions: string[];
}
export interface Options {
  departments: RefOpt[]; clients: RefOpt[]; projects: RefOpt[]; agencies: RefOpt[]; trades: RefOpt[]; users: RefOpt[];
  travelAgencies: RefOpt[]; vehicles: RefOpt[];
  countries: string[]; enums: Record<string, Opt[]>;
}

interface Ctx {
  user: User | null; company: string; loading: boolean; options: Options | null;
  refresh: () => Promise<void>; reloadOptions: () => Promise<void>; logout: () => Promise<void>;
  can: (p: string) => boolean; enumLabel: (list: string, v: unknown) => string; enumTone: (list: string, v: unknown) => string | undefined;
}

const AppCtx = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(AppCtx);

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [company, setCompany] = useState('');
  const [options, setOptions] = useState<Options | null>(null);
  const [loading, setLoading] = useState(true);

  const reloadOptions = useCallback(async () => { setOptions(await api.get<Options>('/options')); }, []);
  const refresh = useCallback(async () => {
    try {
      const me = await api.get<{ user: User; company: string }>('/auth/me');
      setUser(me.user);
      setCompany(me.company);
      await reloadOptions();
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [reloadOptions]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => onApiStatus((s) => { if (s === 401) setUser(null); if (s === 428) refresh(); }), [refresh]);

  const logout = async () => { await api.post('/auth/logout').catch(() => {}); setUser(null); };
  const can = (p: string) => !!user?.permissions.includes(p);
  const enumLabel = (list: string, v: unknown) => options?.enums[list]?.find((o) => o.value === v)?.label ?? (v == null ? '—' : String(v));
  const enumTone = (list: string, v: unknown) => options?.enums[list]?.find((o) => o.value === v)?.tone;

  return <AppCtx.Provider value={{ user, company, loading, options, refresh, reloadOptions, logout, can, enumLabel, enumTone }}>{children}</AppCtx.Provider>;
}
