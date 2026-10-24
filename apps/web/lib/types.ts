import type { SectionType } from '@resume/shared';
export type { SectionType, Section, ResumeDocument } from '@resume/shared';
export interface Template { id: string; title: string; description?: string | null; license?: string | null; style: string; tags: string[]; industry?: string | null; sectionOrder?: SectionType[]; layout?: string; layoutTags?: string[]; sourceUrl?: string | null; thumbnailUrl?: string | null; status?: string; source?: { name: string } | null; reasons?:string[]; score?:number }
export interface Generation { generationId: string; scenario: string; result: { sectionType: SectionType; items: Record<string,string>[]; suggestions: string[] }; quota: { remaining: number | null; dailyLimit: number | null; budgetWarning?: boolean } }
export interface Quota { configured: boolean; customKeyConfigured?: boolean; usingCustomKey?: boolean; remaining: number | null; dailyLimit: number | null; resetAt: string; budgetWarning?: boolean; monthlyReservedTokens?: number; monthlyTokenLimit?: number }
export interface AiSettings { configured: boolean; maskedKey: string | null }
export const sectionLabels: Record<SectionType, string> = { basic: '基本信息', intent: '求职意向', education: '教育经历', work: '工作经历', projects: '项目经历', skills: '专业技能', certificates: '证书荣誉', summary: '自我评价' };
export const fieldDefinitions: Record<SectionType, [string, string, boolean?][]> = {
  basic: [['name','姓名'],['email','邮箱'],['phone','手机'],['city','所在城市'],['website','个人网站']],
  intent: [['role','目标岗位'],['industry','目标行业'],['city','意向城市'],['availability','到岗时间']],
  education: [['school','学校'],['degree','学历'],['major','专业'],['start','开始时间'],['end','结束时间'],['description','学习成果',true]],
  work: [['company','公司'],['role','职位'],['start','开始时间'],['end','结束时间'],['description','工作内容与成果',true]],
  projects: [['name','项目名称'],['role','担任角色'],['start','开始时间'],['end','结束时间'],['description','项目内容与成果',true]],
  skills: [['name','技能名称'],['description','熟练程度与应用',true]],
  certificates: [['name','证书或荣誉'],['issuer','颁发机构'],['date','取得时间']],
  summary: [['description','自我评价',true]],
};
