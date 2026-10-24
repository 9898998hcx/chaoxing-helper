'use client';
import { useCallback,useEffect,useRef,useState } from 'react';
import { api,ApiError,errorMessage,json } from './api';
import type { ResumeDocument } from './types';
export function useResume(id:string){
  const[resume,setResume]=useState<ResumeDocument|null>(null);const[loading,setLoading]=useState(true);const[saving,setSaving]=useState(false);const[error,setError]=useState('');const[conflict,setConflict]=useState(false);const[dirty,setDirty]=useState(false);
  const latest=useRef<ResumeDocument|null>(null),sequence=useRef(0),saved=useRef(0),blocked=useRef(false),inflight=useRef<Promise<boolean>|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const load=useCallback(async()=>{setLoading(true);setError('');try{const{resume}=await api<{resume:ResumeDocument}>(`/resumes/${id}`);latest.current=resume;sequence.current=0;saved.current=0;blocked.current=false;setResume(resume);setConflict(false);setDirty(false);}catch(e){setError(errorMessage(e));}finally{setLoading(false);}},[id]);
  useEffect(()=>{void load();},[load]);
  const change=useCallback((update:(document:ResumeDocument)=>ResumeDocument)=>{if(!latest.current)return;const next=update(latest.current);latest.current=next;sequence.current++;setResume(next);setDirty(true);},[]);
  const flush=useCallback(async():Promise<boolean>=>{
    if(timer.current)clearTimeout(timer.current);
    if(inflight.current)return inflight.current;
    if(blocked.current)return false;
    if(sequence.current===saved.current)return true;
    const run=async()=>{setSaving(true);setError('');try{while(latest.current&&sequence.current>saved.current){const document=latest.current;const captured=sequence.current;const{resume:response}=await api<{resume:ResumeDocument}>(`/resumes/${id}`,json('PATCH',{title:document.title.trim(),templateId:document.templateId,sections:document.sections,revision:document.revision}));saved.current=captured;latest.current={...latest.current,revision:response.revision,updatedAt:response.updatedAt};setResume(latest.current);}setDirty(false);return true;}catch(e){setError(errorMessage(e));if(e instanceof ApiError&&e.status===409){blocked.current=true;setConflict(true);}return false;}finally{setSaving(false);inflight.current=null;}};
    inflight.current=run();return inflight.current;
  },[id]);
  useEffect(()=>{if(dirty&&!conflict){timer.current=setTimeout(()=>void flush(),800);}return()=>{if(timer.current)clearTimeout(timer.current);};},[resume,dirty,conflict,flush]);
  useEffect(()=>{const handler=(e:BeforeUnloadEvent)=>{if(sequence.current>saved.current){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);},[]);
  const replace=useCallback((next:ResumeDocument)=>{latest.current=next;sequence.current=0;saved.current=0;blocked.current=false;setResume(next);setDirty(false);setConflict(false);setError('');},[]);
  return {resume,latest,loading,saving,error,setError,conflict,dirty,change,flush,load,replace};
}
