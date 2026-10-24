import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { initialSections, resumeInputSchema } from '@resume/shared';
import type { ResumeDocument, Section } from '@resume/shared';
import { PrismaService } from '../common/prisma.service.js';
import { apiError } from '../common/errors.js';

type Transaction = Prisma.TransactionClient;
const includeSections = { sections: { orderBy: { order: 'asc' as const } } };

export function serializeResume(row: any): ResumeDocument {
  return {
    id: row.id, userId: row.userId, title: row.title, templateId: row.templateId,
    revision: row.revision, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    sections: row.sections.map((section: any) => ({ id: section.id, type: section.type, title: section.title, visible: section.visible, order: section.order, content: section.content })) as Section[],
  };
}

@Injectable()
export class ResumeService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async templateAllowed(tx: Transaction | PrismaService, templateId: string | null | undefined) {
    if (!templateId) return;
    const template = await tx.template.findFirst({ where: { id: templateId, status: 'APPROVED' }, select: { id: true } });
    if (!template) throw apiError(400, 'TEMPLATE_UNAVAILABLE', '模板不存在或尚未通过审核');
  }

  private sectionsData(sections: Section[], allowedIds = new Set<string>()) {
    return [...sections].sort((a, b) => a.order - b.order).map((section, index) => ({
      id: allowedIds.has(section.id) ? section.id : randomUUID(), type: section.type, title: section.title,
      visible: section.visible, order: index, content: section.content as Prisma.InputJsonValue,
    }));
  }

  private async snapshot(tx: Transaction, resumeId: string) {
    const row = await tx.resume.findUniqueOrThrow({ where: { id: resumeId }, include: includeSections });
    const version = await tx.resumeVersion.upsert({ where: { resumeId_revision: { resumeId, revision: row.revision } }, create: { resumeId, revision: row.revision, data: serializeResume(row) as unknown as Prisma.InputJsonValue }, update: {} });
    const stale = await tx.resumeVersion.findMany({ where: { resumeId }, orderBy: { revision: 'desc' }, skip: 50, select: { id: true } });
    if (stale.length) await tx.resumeVersion.deleteMany({ where: { resumeId, id: { in: stale.map(v => v.id) } } });
    return version;
  }

  async list(userId: string) {
    const rows = await this.prisma.resume.findMany({ where: { userId }, include: includeSections, orderBy: { updatedAt: 'desc' }, take: 100 });
    return { resumes: rows.map(serializeResume) };
  }

  async get(userId: string, id: string) {
    const row = await this.prisma.resume.findFirst({ where: { id, userId }, include: includeSections });
    if (!row) throw apiError(404, 'RESUME_NOT_FOUND', '简历不存在');
    return { resume: serializeResume(row) };
  }

  async create(userId: string, body: unknown) {
    const candidate = body === undefined || body === null ? {} : body;
    const input = resumeInputSchema.parse(typeof candidate === 'object' && !Array.isArray(candidate) ? { title: '未命名简历', sections: initialSections(), ...candidate } : candidate);
    return this.prisma.$transaction(async tx => {
      if (await tx.resume.count({ where: { userId } }) >= 100) throw apiError(409, 'RESUME_LIMIT_REACHED', '最多保存 100 份简历，请先删除不需要的简历');
      await this.templateAllowed(tx, input.templateId);
      const row = await tx.resume.create({ data: { userId, title: input.title, templateId: input.templateId || null, sections: { create: this.sectionsData(input.sections ?? initialSections()) } }, include: includeSections });
      await this.snapshot(tx, row.id);
      return { resume: serializeResume(row) };
    });
  }

  async update(userId: string, id: string, body: unknown, revision: number) {
    const input = resumeInputSchema.parse(body);
    return this.prisma.$transaction(async tx => {
      const existing = await tx.resume.findFirst({ where: { id, userId }, include: includeSections });
      if (!existing) throw apiError(404, 'RESUME_NOT_FOUND', '简历不存在');
      if (input.templateId !== undefined && input.templateId !== existing.templateId) await this.templateAllowed(tx, input.templateId);
      const result = await tx.resume.updateMany({ where: { id, userId, revision }, data: { title: input.title, ...(input.templateId !== undefined ? { templateId: input.templateId || null } : {}), revision: { increment: 1 }, updatedAt: new Date() } });
      if (result.count !== 1) throw apiError(409, 'REVISION_CONFLICT', '简历已在其他页面更新，请重新加载后再保存');
      if (input.sections) {
        await tx.resumeSection.deleteMany({ where: { resumeId: id } });
        await tx.resumeSection.createMany({ data: this.sectionsData(input.sections, new Set(existing.sections.map(s => s.id))).map(section => ({ ...section, resumeId: id })) });
      }
      await this.snapshot(tx, id);
      const row = await tx.resume.findFirstOrThrow({ where: { id, userId }, include: includeSections });
      return { resume: serializeResume(row) };
    });
  }

  async remove(userId: string, id: string) {
    const result = await this.prisma.resume.deleteMany({ where: { id, userId } });
    if (result.count !== 1) throw apiError(404, 'RESUME_NOT_FOUND', '简历不存在');
    return { deleted: true };
  }

  async duplicate(userId: string, id: string) {
    const { resume } = await this.get(userId, id);
    const allowed = resume.templateId ? await this.prisma.template.findFirst({ where: { id: resume.templateId, status: 'APPROVED' } }) : null;
    return this.create(userId, { title: `${resume.title.slice(0, 90)}（副本）`, sections: resume.sections, templateId: allowed?.id ?? null });
  }

  async versions(userId: string, id: string) {
    await this.get(userId, id);
    const versions = await this.prisma.resumeVersion.findMany({ where: { resumeId: id, resume: { userId } }, orderBy: { revision: 'desc' }, select: { id: true, revision: true, createdAt: true }, take: 50 });
    return { versions };
  }

  async createVersion(userId: string, id: string) {
    return this.prisma.$transaction(async tx => {
      const resume = await tx.resume.findFirst({ where: { id, userId }, select: { id: true } });
      if (!resume) throw apiError(404, 'RESUME_NOT_FOUND', '简历不存在');
      const version = await this.snapshot(tx, id);
      return { version: { id: version.id, revision: version.revision, createdAt: version.createdAt } };
    });
  }

  async restore(userId: string, id: string, versionId: string, revision: number) {
    await this.get(userId, id);
    const version = await this.prisma.resumeVersion.findFirst({ where: { id: versionId, resumeId: id, resume: { userId } } });
    if (!version) throw apiError(404, 'VERSION_NOT_FOUND', '版本不存在');
    const data = version.data as unknown as ResumeDocument;
    const template = data.templateId ? await this.prisma.template.findFirst({ where: { id: data.templateId, status: 'APPROVED' } }) : null;
    return this.update(userId, id, { title: data.title, sections: data.sections, templateId: template?.id ?? null }, revision);
  }
}
