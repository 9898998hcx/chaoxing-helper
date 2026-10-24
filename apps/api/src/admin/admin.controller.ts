import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service.ts';
import { AuthGuard } from '../auth/auth.guard.ts';
import { AdminGuard } from '../auth/admin.guard.ts';
import { CrawlerService } from '../crawler/crawler.service.ts';

const sourceFields = z.object({
  name: z.string().trim().min(1).max(120), baseUrl: z.string().url().max(2048),
  tosUrl: z.string().url().max(2048), tosEvidence: z.string().trim().max(4000).optional().nullable(),
  enabled: z.boolean(), permissionConfirmed: z.boolean(),
  robotsRequired: z.literal(true), rateLimitMs: z.number().int().min(3000).max(60000),
  metadataPath: z.string().trim().max(500).refine(value => value.startsWith('/') && !value.startsWith('//') && !value.includes('\\'), '请使用同来源的绝对路径').optional().nullable(),
}).strict();
const sourceSchema = sourceFields.extend({ enabled: z.boolean().default(false), permissionConfirmed: z.boolean().default(false), robotsRequired: z.literal(true).default(true), rateLimitMs: z.number().int().min(3000).max(60000).default(3000) });
const reviewSchema = z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'TAKEN_DOWN']), reviewNote: z.string().trim().min(1).max(2000) }).strict();
function parse<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: '请求字段无效', fields: result.error.flatten().fieldErrors });
  return result.data;
}
function sourcePolicy(source: { baseUrl: string; tosUrl: string; enabled: boolean; permissionConfirmed: boolean; tosEvidence?: string | null; metadataPath?: string | null }) {
  for (const input of [source.baseUrl, source.tosUrl]) {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) throw new BadRequestException({ code: 'INVALID_SOURCE_URL', message: '来源须使用 HTTPS 且不可携带登录信息' });
  }
  if (source.enabled && (!source.permissionConfirmed || !source.tosEvidence?.trim() || !source.metadataPath)) throw new BadRequestException({ code: 'SOURCE_NOT_AUTHORIZED', message: '启用前须填写授权或服务条款依据，并配置公开元数据路径' });
}

@Controller('admin')
@UseGuards(AuthGuard, AdminGuard)
export class AdminController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(CrawlerService) private readonly crawler: CrawlerService) {}
  @Get('sources') async sources() { return { sources: await this.prisma.templateSource.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }) }; }
  @Post('sources') async createSource(@Body() body: unknown, @Req() req: any) {
    const data = parse(sourceSchema, body); sourcePolicy(data);
    const source = await this.prisma.$transaction(async tx => {
      const source = await tx.templateSource.create({ data });
      await tx.auditLog.create({ data: { actorId: req.user.id, action: 'SOURCE_CREATE', targetType: 'TemplateSource', targetId: source.id, metadata: { enabled: source.enabled, permissionConfirmed: source.permissionConfirmed } } });
      return source;
    });
    return { source };
  }
  @Patch('sources/:id') async updateSource(@Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    const patch = parse(sourceFields.partial(), body);
    const previous = await this.prisma.templateSource.findUnique({ where: { id } });
    if (!previous) throw new NotFoundException({ code: 'SOURCE_NOT_FOUND', message: '来源不存在' });
    const scopeChanged = (patch.baseUrl !== undefined && patch.baseUrl !== previous.baseUrl) || (patch.tosUrl !== undefined && patch.tosUrl !== previous.tosUrl) || (patch.metadataPath !== undefined && patch.metadataPath !== previous.metadataPath);
    if (scopeChanged && !(patch.permissionConfirmed === true && patch.tosEvidence?.trim())) { patch.enabled = false; patch.permissionConfirmed = false; }
    sourcePolicy({ ...previous, ...patch });
    const source = await this.prisma.$transaction(async tx => {
      const source = await tx.templateSource.update({ where: { id }, data: patch });
      await tx.auditLog.create({ data: { actorId: req.user.id, action: 'SOURCE_UPDATE', targetType: 'TemplateSource', targetId: id, metadata: { enabled: source.enabled, permissionConfirmed: source.permissionConfirmed } } });
      return source;
    });
    return { source };
  }
  @Post('sources/:id/crawl') crawl(@Param('id') id: string, @Req() req: any) { return this.crawler.trigger(id, req.user.id); }
  @Get('crawl-jobs') async jobs() { return { jobs: await this.prisma.crawlJob.findMany({ orderBy: { createdAt: 'desc' }, include: { source: { select: { id: true, name: true } } }, take: 100 }) }; }
  @Get('templates') async templates(@Query('status') status?: string) {
    const parsed = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'TAKEN_DOWN']).optional().safeParse(status || undefined);
    if (!parsed.success) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: '模板状态无效' });
    return { templates: await this.prisma.template.findMany({ where: parsed.data ? { status: parsed.data } : {}, orderBy: { updatedAt: 'desc' }, take: 200 }) };
  }
  @Patch('templates/:id') async review(@Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    const data = parse(reviewSchema, body);
    const previous = await this.prisma.template.findUnique({ where: { id } });
    if (!previous) throw new NotFoundException({ code: 'TEMPLATE_NOT_FOUND', message: '模板不存在' });
    if (data.status === 'APPROVED' && previous.sourceId) {
      const source = await this.prisma.templateSource.findUnique({ where: { id: previous.sourceId } });
      if (!source?.permissionConfirmed || !source.tosEvidence?.trim()) throw new BadRequestException({ code: 'SOURCE_NOT_AUTHORIZED', message: '外部模板发布前须确认来源授权依据' });
    }
    const template = await this.prisma.$transaction(async tx => {
      const template = await tx.template.update({ where: { id }, data });
      await tx.auditLog.create({ data: { actorId: req.user.id, action: data.status === 'TAKEN_DOWN' ? 'TEMPLATE_TAKEDOWN' : 'TEMPLATE_REVIEW', targetType: 'Template', targetId: id, metadata: { previousStatus: previous.status, status: data.status, reason: data.reviewNote } } });
      return template;
    });
    return { template };
  }
  @Get('audit-logs') async auditLogs() { return { logs: await this.prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }) }; }
}
