import { Suspense } from 'react';
import { AuthForm } from '../../components/auth-form';
export const metadata = { title: '注册' };
export default function RegisterPage(){return <Suspense fallback={<div className="page-state">正在加载…</div>}><AuthForm mode="register"/></Suspense>;}
