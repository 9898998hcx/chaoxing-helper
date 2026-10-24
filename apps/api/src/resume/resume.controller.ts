import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthRequest } from '../auth/auth.types.js';
import { RedisService } from '../common/redis.service.js';
import { ResumeService } from './resume.service.js';

const revisionSchema = z.object({ revision: z.number().int().min(1).max(2_147_483_646) });
const idSchema = z.string().min(1).max(128);

@Controller('resumes') @UseGuards(AuthGuard)
export class ResumeController {
  constructor(@Inject(ResumeService) private readonly resumes: ResumeService, @Inject(RedisService) private readonly redis: RedisService) {}

  @Get() list(@Req() request: AuthRequest) { return this.resumes.list(request.user.id); }
  @Post() async create(@Req() request: AuthRequest, @Body() body: unknown) {
    await this.redis.consume(`resume:create:${request.user.id}`, 30, 60);
    return this.resumes.create(request.user.id, body);
  }
  @Get(':id') get(@Req() request: AuthRequest, @Param('id') id: string) { return this.resumes.get(request.user.id, idSchema.parse(id)); }
  @Patch(':id') async update(@Req() request: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    await this.redis.consume(`resume:save:${request.user.id}`, 120, 60);
    const { revision } = revisionSchema.parse(body);
    // Revision is transport concurrency metadata, never part of the resume body schema.
    const { revision: _revision, ...input } = body as Record<string, unknown>;
    return this.resumes.update(request.user.id, idSchema.parse(id), input, revision);
  }
  @Delete(':id') remove(@Req() request: AuthRequest, @Param('id') id: string) { return this.resumes.remove(request.user.id, idSchema.parse(id)); }
  @Post(':id/duplicate') async duplicate(@Req() request: AuthRequest, @Param('id') id: string) {
    await this.redis.consume(`resume:create:${request.user.id}`, 30, 60);
    return this.resumes.duplicate(request.user.id, idSchema.parse(id));
  }
  @Get(':id/versions') versions(@Req() request: AuthRequest, @Param('id') id: string) { return this.resumes.versions(request.user.id, idSchema.parse(id)); }
  @Post(':id/versions') snapshot(@Req() request: AuthRequest, @Param('id') id: string) { return this.resumes.createVersion(request.user.id, idSchema.parse(id)); }
  @Post(':id/versions/:versionId/restore') restore(@Req() request: AuthRequest, @Param('id') id: string, @Param('versionId') versionId: string, @Body() body: unknown) {
    return this.resumes.restore(request.user.id, idSchema.parse(id), idSchema.parse(versionId), revisionSchema.strict().parse(body).revision);
  }
}
