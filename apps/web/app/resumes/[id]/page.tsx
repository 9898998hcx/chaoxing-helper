import { Suspense } from 'react';
import { ResumeEditor } from '../../../components/resume-editor';
export const metadata={title:'编辑简历'};
export default async function EditorPage({params}:{params:Promise<{id:string}>}){const{id}=await params;return <Suspense fallback={<div className="page-state">正在加载编辑器…</div>}><ResumeEditor id={id}/></Suspense>;}
