import {describe,it,expect} from 'vitest';
import {initialSections,type ResumeDocument} from '@resume/shared';
import {escapeHtml,pdfFilename,renderResumeHtml} from './html.js';
describe('safe PDF HTML',()=>{
  it('escapes user text and omits hidden sections',()=>{
    const resume:ResumeDocument={id:'r',userId:'u',title:'我的简历',templateId:null,revision:1,createdAt:'',updatedAt:'',sections:initialSections()};
    resume.sections[0].content[0].name='<script>alert(1)</script>';
    resume.sections[3].visible=false;resume.sections[3].content[0].description='hidden-private';
    const html=renderResumeHtml(resume,'clean');expect(html).not.toContain('<script>');expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('hidden-private');expect(html).toContain('size:A4');
  });
  it('normalizes filename control and path characters',()=>{expect(pdfFilename('../简历\r\n/恶意.pdf')).not.toMatch(/[\r\n/]/);expect(escapeHtml('"&')).toBe('&quot;&amp;');});
  it('respects basic and intent ordering and hides private basic fields',()=>{
    const resume:ResumeDocument={id:'r',userId:'u',title:'title',templateId:null,revision:1,createdAt:'',updatedAt:'',sections:initialSections()};
    resume.sections[0].order=1;resume.sections[0].content[0].name='private-name';resume.sections[1].order=0;resume.sections[1].content[0].role='intent-first';
    const html=renderResumeHtml(resume,'compact');expect(html.indexOf('intent-first')).toBeLessThan(html.indexOf('private-name'));
    resume.sections[0].visible=false;expect(renderResumeHtml(resume,'clean')).not.toContain('private-name');
  });
});
