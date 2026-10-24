'use client';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api, ApiError, errorMessage, json, setCsrfToken } from '../lib/api';

export interface User { id: string; email: string; role: 'USER' | 'ADMIN'; emailVerifiedAt: string | null }
interface SessionResponse { user: User; csrfToken: string }
const SessionContext = createContext<{user: User | null; loading: boolean; error: string; refresh: () => Promise<void>; establish: (session: SessionResponse) => void; logout: () => Promise<void> } | null>(null);
export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const establish = useCallback((session: SessionResponse) => { setUser(session.user); setCsrfToken(session.csrfToken); setError(''); }, []);
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try { establish(await api<SessionResponse>('/auth/me')); }
    catch (error) { if (!(error instanceof ApiError && error.status === 401)) setError(errorMessage(error)); setUser(null); setCsrfToken(''); }
    finally { setLoading(false); }
  }, [establish]);
  useEffect(() => { void refresh(); }, [refresh]);
  const logout = async () => { await api('/auth/logout', json('POST')); setUser(null); setCsrfToken(''); };
  return <SessionContext.Provider value={{ user, loading, error, refresh, establish, logout }}>{children}</SessionContext.Provider>;
}
export function useSession() { const value = useContext(SessionContext); if (!value) throw new Error('SessionProvider missing'); return value; }
export function Protected({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const { user, loading, error, refresh } = useSession();
  const router = useRouter(); const pathname = usePathname();
  useEffect(() => { if (!loading && !error && !user) router.replace(`/login?next=${encodeURIComponent(pathname)}`); }, [loading, error, user, router, pathname]);
  if (loading) return <div className="page-state" role="status"><span className="spinner" />正在确认登录状态…</div>;
  if (error) return <div className="page-state"><p role="alert">{error}</p><button className="button" onClick={() => void refresh()}>重新连接</button></div>;
  if (!user) return <div className="page-state" role="status">正在前往登录…</div>;
  if (admin && user.role !== 'ADMIN') return <div className="page-state"><h1>无权访问</h1><p>此页面仅对管理员开放。</p></div>;
  return <>{children}</>;
}
