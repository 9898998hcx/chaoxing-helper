import Link from 'next/link';
export default function NotFound(){return <div className="page-state"><h1>没有找到这个页面</h1><p>链接可能已失效，或页面已被移除。</p><Link className="button" href="/resumes">进入我的简历</Link></div>;}
