import { Suspense } from 'react';
import { Verification } from '../../components/verification';
export const metadata={title:'验证邮箱'};
export default function VerifyEmailPage(){return <Suspense fallback={<div className="page-state">正在加载…</div>}><Verification/></Suspense>;}
