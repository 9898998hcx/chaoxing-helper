import { z } from 'zod';

export const sectionTypes = ['basic','intent','education','work','projects','skills','certificates','summary'] as const;
export type SectionType = typeof sectionTypes[number];
export const sectionTitles: Record<SectionType,string> = { basic:'基本信息', intent:'求职意向', education:'教育经历', work:'工作经历', projects:'项目经历', skills:'专业技能', certificates:'证书荣誉', summary:'自我评价' };
export const sectionFields: Record<SectionType, {key:string;label:string;multiline?:boolean}[]> = {
  basic:[{key:'name',label:'姓名'},{key:'email',label:'邮箱'},{key:'phone',label:'电话'},{key:'city',label:'城市'}],
  intent:[{key:'role',label:'求职岗位'},{key:'industry',label:'目标行业'}],
  education:[{key:'school',label:'学校'},{key:'degree',label:'学历'},{key:'major',label:'专业'},{key:'start',label:'开始时间'},{key:'end',label:'结束时间'},{key:'description',label:'学习经历',multiline:true}],
  work:[{key:'company',label:'公司'},{key:'role',label:'职位'},{key:'start',label:'开始时间'},{key:'end',label:'结束时间'},{key:'description',label:'工作内容与成果',multiline:true}],
  projects:[{key:'name',label:'项目名称'},{key:'role',label:'担任角色'},{key:'start',label:'开始时间'},{key:'end',label:'结束时间'},{key:'description',label:'项目内容与成果',multiline:true}],
  skills:[{key:'name',label:'技能名称'},{key:'description',label:'技能说明',multiline:true}],
  certificates:[{key:'name',label:'证书名称'},{key:'date',label:'获得时间'},{key:'issuer',label:'颁发机构'}],
  summary:[{key:'description',label:'自我评价',multiline:true}]
};
const contentSchema = z.record(z.string().max(40), z.string().max(6000)).refine(o => Object.keys(o).length <= 12, '字段过多');
export const sectionSchema = z.object({ id:z.string().min(1).max(100),type:z.enum(sectionTypes),title:z.string().min(1).max(50),visible:z.boolean(),order:z.number().int().min(0).max(20),content:z.array(contentSchema).max(30) }).strict();
export type Section = z.infer<typeof sectionSchema>;
export const resumeInputSchema = z.object({ title:z.string().trim().min(1).max(100),templateId:z.string().min(1).max(100).nullable().optional(),sections:z.array(sectionSchema).min(1).max(8).refine(s=>new Set(s.map(x=>x.type)).size===s.length,'模块不能重复').refine(s=>new Set(s.map(x=>x.id)).size===s.length,'模块标识不能重复').optional() }).strict();
export type ResumeInput = z.infer<typeof resumeInputSchema>;
export interface ResumeDocument { id:string;userId:string;title:string;templateId:string|null;revision:number;sections:Section[];createdAt:string;updatedAt:string }
export function initialSections(): Section[] { return sectionTypes.map((type,order)=>({ id:`section-${type}`,type,title:sectionTitles[type],visible:true,order,content:[Object.fromEntries(sectionFields[type].map(f=>[f.key,'']))] })); }
export const aiScenarios = ['generate-section','polish','summary','suggestions'] as const;
export const aiInputSchema = z.object({resumeId:z.string().min(1).max(100),scenario:z.enum(aiScenarios),sectionType:z.enum(sectionTypes).optional(),jd:z.string().max(8000).optional(),experience:z.string().max(10000).optional(),content:z.string().max(12000).optional(),templateId:z.string().min(1).max(100).optional()}).strict();
export const aiResultSchema = z.object({sectionType:z.enum(sectionTypes),items:z.array(contentSchema).max(20),suggestions:z.array(z.string().max(1000)).max(12)}).strict();
export type AiResult = z.infer<typeof aiResultSchema>;
export const aiJsonSchema = {type:'object',additionalProperties:false,required:['sectionType','items','suggestions'],properties:{sectionType:{type:'string',enum:sectionTypes},items:{type:'array',maxItems:20,items:{type:'object',maxProperties:12,additionalProperties:{type:'string',maxLength:6000}}},suggestions:{type:'array',maxItems:12,items:{type:'string',maxLength:1000}}}};
