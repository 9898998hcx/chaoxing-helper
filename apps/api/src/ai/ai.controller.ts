import { Body, Controller, Get, Inject, Post, Put, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthRequest } from '../auth/auth.types.js';
import { AiService } from './ai.service.js';

@Controller('ai') @UseGuards(AuthGuard)
export class AiController {
  constructor(@Inject(AiService) private readonly ai: AiService) {}
  @Get('quota') quota(@Req() request: AuthRequest) { return this.ai.quota(request.user.id); }
  @Get('settings') settings(@Req() request: AuthRequest) { return this.ai.getSettings(request.user.id); }
  @Put('settings') settingsUpdate(@Req() request: AuthRequest, @Body() body: unknown) {
    const parsed = z.object({ apiKey: z.union([z.string().trim().max(256), z.null()]) }).strict().safeParse(body);
    if (!parsed.success) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'API Key 字段无效' });
    return this.ai.setSettings(request.user.id, parsed.data.apiKey);
  }
  @Post('generate') generate(@Req() request: AuthRequest, @Body() body: unknown) { return this.ai.generate(request.user.id, body); }
}
