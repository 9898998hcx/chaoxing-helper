import { BadRequestException, Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { TemplateService } from './template.service.ts';

@Controller('templates')
export class TemplateController {
  constructor(@Inject(TemplateService) private readonly templates: TemplateService) {}
  @Get() list(@Query() query: unknown) {
    const parsed = z.object({ tag: z.string().max(80).optional(), style: z.string().max(40).optional(), industry: z.string().max(80).optional() }).safeParse(query);
    if (!parsed.success) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: '筛选参数无效' });
    return this.templates.list(parsed.data);
  }
  @Get('recommendations') recommend(@Query() query: unknown) {
    const parsed = z.object({ role: z.string().max(120).optional(), industry: z.string().max(80).optional(), experience: z.string().max(2000).optional() }).safeParse(query);
    if (!parsed.success) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: '推荐参数无效' });
    return this.templates.recommend(parsed.data);
  }
  @Get(':id') detail(@Param('id') id: string) { return this.templates.detail(id); }
}
