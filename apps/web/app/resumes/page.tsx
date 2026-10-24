import { Suspense } from 'react';
import { ResumeList } from '../../components/resume-list';
export const metadata={title:'我的简历'};
export default function ResumesPage(){return <Suspense fallback={<div className="page-state">正在加载…</div>}><ResumeList/></Suspense>;}
