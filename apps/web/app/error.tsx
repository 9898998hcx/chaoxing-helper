'use client';
export default function ErrorPage({reset}:{reset:()=>void}){return <div className="page-state"><h1>页面暂时无法显示</h1><p>请重新加载。已保存在账户中的简历内容仍然可用。</p><button className="button" onClick={reset}>重新加载页面</button></div>;}
