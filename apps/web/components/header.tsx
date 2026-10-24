'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useSession } from './session';
import { errorMessage } from '../lib/api';
export function Header() {
  const { user, loading, logout } = useSession(); const pathname = usePathname(); const router = useRouter(); const [error,setError] = useState(''); const [busy,setBusy] = useState(false);
  return <><a className="skip-link" href="#main">跳到主要内容</a><header className="site-header"><Link href="/" className="brand" aria-label="履历工坊首页"><span className="brand-mark" aria-hidden="true"><i/><i/><i/></span>履历工坊</Link><nav aria-label="主要导航"><Link className={pathname.startsWith('/resumes') ? 'active' : ''} href="/resumes">我的简历</Link><Link className={pathname.startsWith('/templates') ? 'active' : ''} href="/templates">结构参考</Link>{user?.role === 'ADMIN' ? <Link href="/admin">管理后台</Link> : null}</nav><div className="account-nav">{loading ? <span className="muted">连接中…</span> : user ? <><span className="account-email" title={user.email}>{user.email}</span><button className="text-button" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await logout();router.push('/login');}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}}>{busy?'退出中…':'退出'}</button></> : <><Link href="/login">登录</Link><Link href="/register" className="button small">免费注册</Link></>}</div></header>{error ? <div role="alert" className="global-error">{error}</div> : null}</>;
}
