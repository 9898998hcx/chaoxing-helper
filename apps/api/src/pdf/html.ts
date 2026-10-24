import type { ResumeDocument } from '@resume/shared';
import { sectionFields } from '@resume/shared';

export const pdfStyles = ['professional','clean','compact'] as const;
export type PdfStyle = typeof pdfStyles[number];
export function escapeHtml(value: unknown) { return String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!)); }
export function renderResumeHtml(resume: ResumeDocument, style: PdfStyle, fontCss = '') {
  const sections = [...resume.sections].filter(s=>s.visible).sort((a,b)=>a.order-b.order);
  const accent = style==='clean' ? '#18776c' : '#243f61';
  const blocks = sections.map(section=>{
    if(section.type==='basic'){
      const basic=section.content[0];
      return `<header><h1>${escapeHtml(basic?.name || resume.title)}</h1><p>${[basic?.email,basic?.phone,basic?.city].filter(Boolean).map(escapeHtml).join('　 |　 ')}</p></header>`;
    }
    const rows=section.content.map(item=>{
      const entries=sectionFields[section.type].filter(f=>item[f.key]?.trim());
      if(!entries.length) return '';
      return `<div class="entry">${entries.map(f=>`<div class="field ${f.multiline?'long':''}">${f.multiline?'':`<span class="label">${escapeHtml(f.label)}：</span>`}${escapeHtml(item[f.key])}</div>`).join('')}</div>`;
    }).join('');
    return rows ? `<section><h2>${escapeHtml(section.title)}</h2>${rows}</section>` : '';
  }).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(resume.title)}</title><style>
  ${fontCss}
  @page{size:A4;margin:16mm 17mm 17mm}*{box-sizing:border-box}body{margin:0;color:#253244;font: ${style==='compact'?'10':'11'}pt/1.65 'Resume CJK','Noto Sans CJK SC','Microsoft YaHei',sans-serif;overflow-wrap:anywhere}
  h1{font-size:25pt;line-height:1.3;margin:0 0 7px;color:${accent}}header{border-bottom:2px solid ${accent};padding-bottom:12px;margin-bottom:17px}header p{margin:0;font-size:10pt;color:#445267}h2{font-size:12pt;line-height:1.5;color:${accent};margin:15px 0 8px;border-bottom:1px solid #cdd5df;padding-bottom:3px;break-after:avoid}section{margin:0 0 10px}.entry{break-inside:avoid-page;margin:0 0 11px}.field{display:inline;margin-right:14px;white-space:pre-wrap}.field.long{display:block;margin:4px 0}.label{color:#5a6778;font-size:9pt}p{white-space:pre-wrap}a{color:inherit}
  </style></head><body>${blocks || '<p>请在编辑器填写并保存简历内容。</p>'}</body></html>`;
}
export function pdfFilename(title: string) { return `${title.replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g,'').trim().slice(0,70) || '简历'}.pdf`; }
