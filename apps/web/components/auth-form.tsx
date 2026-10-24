'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api, errorMessage, json } from '../lib/api';
import { useSession, type User } from './session';

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const register=mode==='register';const router=useRouter();const params=useSearchParams();const{establish}=useSession();
  const[email,setEmail]=useState('');const[password,setPassword]=useState('');const[show,setShow]=useState(false);const[busy,setBusy]=useState(false);const[error,setError]=useState('');
  async function submit(event:FormEvent){
    event.preventDefault();if(busy)return;setError('');
    if(new TextEncoder().encode(password).length>72){setError('密码最多 72 字节；中文字符会占用多个字节。');return;}
    setBusy(true);
    try{const response=await api<{user:User;csrfToken:string}>(`/auth/${mode}`,json('POST',{email:email.trim(),password}));establish(response);const next=params.get('next');router.replace(next?.startsWith('/')&&!next.startsWith('//')?next:'/resumes');}
    catch(e){setError(errorMessage(e));}finally{setBusy(false);}
  }
  return <div className="auth-layout"><aside className="auth-aside"><span className="auth-stroke"/><h1>下一段经历，<br/>从这里开始。</h1><p>给你的职业故事，<br/>留一处认真打磨的空间。</p><div className="auth-bottom">履历工坊 · 你的简历工作台</div></aside><section className="auth-main"><div className="auth-box">
    <h2>{register?'创建你的账户':'欢迎回来'}</h2><p className="muted">{register?'保存每一次打磨，准备下一次出发。':'继续整理那些值得被看见的经历。'}</p>
    <form onSubmit={submit} aria-busy={busy}>
      <label className="field" htmlFor="auth-email">邮箱<input id="auth-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/></label>
      <div className="field"><label htmlFor="auth-password">密码</label><div className="password-field"><input id="auth-password" type={show?'text':'password'} autoComplete={register?'new-password':'current-password'} required minLength={10} maxLength={72} value={password} onChange={e=>setPassword(e.target.value)} aria-describedby={register?'password-help':undefined}/><button type="button" className="text-button" onClick={()=>setShow(v=>!v)} aria-label={show?'隐藏密码':'显示密码'}>{show?'隐藏':'显示'}</button></div></div>
      {register?<p id="password-help" className="field-help">使用至少 10 位的长密码，最多 72 字节。</p>:null}
      {error?<p className="notice error" role="alert">{error}</p>:null}
      <button className="button full" disabled={busy}>{busy?<><span className="spinner"/>{register?'正在创建…':'正在登录…'}</>:register?'创建账户':'登录'}</button>
    </form><p className="auth-switch">{register?'已有账户？':'还没有账户？'} <Link href={register?'/login':'/register'}>{register?'登录':'免费注册'}</Link></p>
  </div></section></div>;
}
