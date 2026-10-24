'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { api,errorMessage,json } from '../lib/api';
import { useSession } from './session';
export function Verification(){const params=useSearchParams();const token=params.get('token');const{refresh}=useSession();const[busy,setBusy]=useState(false);const[error,setError]=useState('');const[success,setSuccess]=useState(false);return <div className="page"><div className="create-panel" style={{margin:'40px auto'}}><h1 style={{fontSize:28}}>验证你的邮箱</h1>{success?<><p className="notice success" role="status">邮箱验证成功，可以继续编辑和生成简历。</p><Link className="button" href="/resumes">进入我的简历</Link></>:<><p className="muted">点击下方按钮完成验证。验证链接有有效期，只能使用一次。</p>{token?<button className="button" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await api('/auth/verify-email',json('POST',{token}));await refresh();setSuccess(true);}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}}>{busy?'正在验证…':'确认验证邮箱'}</button>:<p className="notice warning">验证链接缺少令牌，请从邮件中打开完整链接。</p>}{error?<p className="notice error" role="alert">{error}</p>:null}<p className="small-text" style={{marginTop:20}}>链接已过期？<Link href="/resumes">登录后重新发送验证邮件</Link></p></>}</div></div>;}
