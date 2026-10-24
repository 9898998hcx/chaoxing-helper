import { Body, Controller, Inject, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { Response } from 'express';
import type { AuthRequest } from '../auth/auth.types.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { PdfService } from './pdf.service.js';
import { pdfFilename, pdfStyles } from './html.js';
@Controller('resumes')
@UseGuards(AuthGuard)
export class PdfController{
  constructor(@Inject(PdfService) private readonly pdf:PdfService){}
  @Post(':id/pdf')
  async download(@Req()req:AuthRequest,@Param('id')id:string,@Body()body:unknown,@Res()res:Response){
    const input=z.object({style:z.enum(pdfStyles).default('professional')}).strict().parse(body || {});
    const file=await this.pdf.generate(req.user!.id,id,input.style);
    const fallback=`resume-${id.replace(/[^a-zA-Z0-9-]/g,'').slice(0,40)}.pdf`;
    res.status(200).set({'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(pdfFilename(file.title))}`,'Content-Length':file.pdf.length,'Cache-Control':'no-store'}).send(file.pdf);
  }
}
