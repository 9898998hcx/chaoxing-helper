import { memo } from 'react';
import type { ResumeDocument, Section } from '../lib/types';
const headings: Record<string,string[]>={intent:['role','industry','city','availability'],education:['school','degree','major'],work:['company','role'],projects:['name','role'],skills:['name'],certificates:['name','issuer']};
export const ResumePreview=memo(function ResumePreview({resume,style='professional'}:{resume:ResumeDocument;style?:string}) {
  const sections=[...resume.sections].sort((a,b)=>a.order-b.order).filter(section=>section.visible);
  return <article className={`resume-paper ${style}`} aria-label="简历实时预览">{sections.map(section=>{
    if(section.type==='basic'){
      const basic=section.content[0]||{};
      return <header key={section.id}><h1 className="resume-name">{basic.name||'你的姓名'}</h1><div className="resume-contact">{[basic.phone,basic.email,basic.city,basic.website].filter(Boolean).join('　|　')||'联系方式将在这里显示'}</div></header>;
    }
    return <PreviewSection key={section.id} section={section}/>;
  })}</article>;
});
function PreviewSection({section}:{section:Section}) {
  const hasContent=section.content.some(item=>Object.values(item).some(Boolean));
  return <section><h2>{section.title}</h2>{hasContent?section.content.map((item,index)=>{
    const used=new Set([...(headings[section.type]||[]),'start','end','startDate','endDate','description','date']);
    const title=(headings[section.type]||[]).map(key=>item[key]).filter(Boolean).join(' / ');
    const dates=[item.start||item.startDate,item.end||item.endDate].filter(Boolean).join(' — ')||item.date;
    return <div className="resume-entry" key={index}>{title||dates?<div className="resume-entry-head"><strong>{title}</strong><span>{dates}</span></div>:null}{item.description?<p className="resume-description">{item.description}</p>:null}{Object.entries(item).filter(([key,value])=>!used.has(key)&&value).map(([key,value])=><p className="resume-description" key={key}>{value}</p>)}</div>;
  }):<p className="preview-empty">补充你的{section.title}…</p>}</section>;
}
export function MiniPaper({title='你的姓名',sections=['工作经历','项目经历','教育经历']}:{title?:string;sections?:string[]}) {return <div className="mini-paper" aria-hidden="true"><h3>{title}</h3><p>求职方向 / 联系方式</p>{sections.map((section,index)=><div key={`${section}-${index}`} className="mini-section"><b>{section}</b><div className="mini-line"/><div className="mini-line"/><div className="mini-line"/></div>)}</div>;}
