import { Suspense } from 'react';
import { AuthForm } from '../../components/auth-form';
export const metadata = { title: '登录' };
export default function LoginPage(){return <Suspense fallback={<div className="page-state">正在加载…</div>}><AuthForm mode="login"/></Suspense>;}
