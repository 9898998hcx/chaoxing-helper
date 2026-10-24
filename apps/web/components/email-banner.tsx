'use client';
import { useState } from 'react';
import { useSession } from './session';
import { api,errorMessage,json } from '../lib/api';
export function EmailBanner(){const {user}=useSession();const[message,setMessage]=useState('');const[busy,setBusy]=useState(false);if(!user||user.emailVerifiedAt)return null;return <div className="notice warning"><div>邮箱尚未验证。生产环境中，验证后才能使用编辑、AI 与下载功能。</div><button className="text-button" disabled={busy} onClick={async()=>{setBusy(true);try{await api('/auth/resend-verification',json('POST'));setMessage('验证邮件已发送，请检查邮箱。');}catch(e){setMessage(errorMessage(e));}finally{setBusy(false);}}}>{busy?'正在发送…':'发送验证邮件'}</button>{message?<p role="status" style={{margin:0}}>{message}</p>:null}</div>;}
