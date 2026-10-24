import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service.ts';

export const stringArray = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
const tokens = (value: string) => new Set(value.toLowerCase().split(/[\s,，、;；/|]+/u).filter(Boolean));

@Injectable()
export class TemplateService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(filter: { tag?: string; style?: string; industry?: string } = {}) {
    const templates = await this.prisma.template.findMany({
      where: { status: 'APPROVED', ...(filter.style ? { style: filter.style } : {}), ...(filter.industry ? { industry: filter.industry } : {}) },
      orderBy: { updatedAt: 'desc' }, take: 200,
    });
    return { templates: filter.tag ? templates.filter(t => stringArray(t.tags).includes(filter.tag!)) : templates };
  }

  async detail(id: string) {
    const template = await this.prisma.template.findFirst({ where: { id, status: 'APPROVED' } });
    if (!template) throw new NotFoundException({ code: 'TEMPLATE_NOT_FOUND', message: '模板不存在或已下架' });
    return { template };
  }

  async recommend(input: { role?: string; industry?: string; experience?: string }) {
    const { templates } = await this.list();
    const query = tokens([input.role, input.industry, input.experience].filter(Boolean).join(' '));
    const results = templates.map(template => {
      const tags = stringArray(template.tags);
      const words = tokens([...tags, template.industry || '', template.style].join(' '));
      const intersection = [...words].filter(word => query.has(word)).length;
      const union = new Set([...words, ...query]).size;
      const exactIndustry = !!input.industry && template.industry?.toLowerCase() === input.industry.toLowerCase();
      const roleHit = !!input.role && tags.some(tag => input.role!.toLowerCase().includes(tag.toLowerCase()) || tag.toLowerCase().includes(input.role!.toLowerCase()));
      return { ...template, score: Number(((union ? intersection / union : 0) + (exactIndustry ? 1 : 0) + (roleHit ? 0.5 : 0)).toFixed(4)), reasons: [...(exactIndustry ? ['行业匹配'] : []), ...(roleHit ? ['岗位标签匹配'] : []), ...(intersection ? ['经历关键词匹配'] : [])] };
    }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    return { templates: results.slice(0, 12), fallback: results.every(t => t.score === 0), method: 'tags-and-jaccard' };
  }
}
