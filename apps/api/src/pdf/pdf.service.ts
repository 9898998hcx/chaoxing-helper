import { Inject, Injectable } from '@nestjs/common';
import { access, readFile } from 'node:fs/promises';
import { chromium, type Browser } from 'playwright';
import { PrismaService } from '../common/prisma.service.js';
import { RedisService } from '../common/redis.service.js';
import { apiError } from '../common/errors.js';
import { serializeResume } from '../resume/resume.service.js';
import { renderResumeHtml, type PdfStyle } from './html.js';

async function exists(path:string) { try{await access(path);return true;}catch{return false;} }
function positive(name:string, fallback:number, max:number) { const n=Number(process.env[name] || fallback);return Number.isFinite(n)&&n>0?Math.min(n,max):fallback; }
@Injectable()
export class PdfService {
  private active = 0;
  constructor(@Inject(PrismaService) private readonly prisma:PrismaService,@Inject(RedisService) private readonly redis:RedisService) {}
  async generate(userId:string,id:string,style:PdfStyle) {
    const row=await this.prisma.resume.findFirst({where:{id,userId},include:{sections:{orderBy:{order:'asc'}}}});
    if(!row) throw apiError(404,'RESUME_NOT_FOUND','简历不存在');
    const resume=serializeResume(row);
    if(Buffer.byteLength(JSON.stringify(resume),'utf8')>positive('PDF_MAX_INPUT_BYTES',200000,500000)) throw apiError(413,'PDF_INPUT_TOO_LARGE','简历内容过长，请缩减后再导出');
    await this.redis.consume(`pdf:${userId}`,3,60);
    if(this.active>=positive('PDF_CONCURRENCY',2,8)) throw apiError(429,'PDF_BUSY','PDF 生成繁忙，请稍后重试');
    this.active++;
    let browser:Browser|undefined;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const deadline=positive('PDF_TIMEOUT_MS',20000,60000);
    let expired=false;
    try{
      let fontCss='';
      if(process.env.PDF_FONT_PATH){
        if(!await exists(process.env.PDF_FONT_PATH)) throw apiError(503,'PDF_FONT_MISSING','配置的中文字体文件不存在');
        const data=await readFile(process.env.PDF_FONT_PATH);
        if(data.length>30*1024*1024) throw apiError(503,'PDF_FONT_TOO_LARGE','字体文件过大');
        fontCss=`@font-face{font-family:'Resume CJK';src:url(data:font/ttf;base64,${data.toString('base64')})}`;
      }else{
        const fontPaths=process.platform==='win32'?['C:/Windows/Fonts/msyh.ttc']:['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc','/usr/share/fonts/truetype/noto/NotoSansSC-Regular.ttf'];
        if(!(await Promise.all(fontPaths.map(exists))).some(Boolean)) throw apiError(503,'PDF_FONT_MISSING','未检测到中文字体，请安装 Noto Sans CJK 或设置 PDF_FONT_PATH');
      }
      let executablePath=process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined;
      if(!executablePath && process.platform==='win32'){
        const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
        if(await exists(edge)) executablePath=edge;
      }
      browser=await chromium.launch({headless:true,executablePath,timeout:deadline,args:['--disable-dev-shm-usage']});
      const current=browser;
      const result=await Promise.race([
        (async()=>{
          const context=await current.newContext({javaScriptEnabled:false,serviceWorkers:'block',offline:true});
          await context.route('**/*',route=>route.abort());
          const page=await context.newPage();
          page.setDefaultTimeout(deadline);
          await page.setContent(renderResumeHtml(resume,style,fontCss),{waitUntil:'load',timeout:deadline});
          await page.emulateMedia({media:'print'});
          const pdf=await page.pdf({format:'A4',printBackground:true,preferCSSPageSize:true,tagged:true});
          if(expired) throw apiError(504,'PDF_TIMEOUT','生成 PDF 超时，请稍后重试');
          if(pdf.length>positive('PDF_MAX_BYTES',10485760,20971520)) throw apiError(413,'PDF_TOO_LARGE','生成的 PDF 超过大小上限');
          return pdf;
        })(),
        new Promise<never>((_,reject)=>{timer=setTimeout(()=>{expired=true;void current.close();reject(apiError(504,'PDF_TIMEOUT','生成 PDF 超时，请稍后重试'));},deadline);})
      ]);
      if(process.env.S3_ARCHIVE_PDFS==='true') await this.archive(userId,id,result);
      return {pdf:result,title:resume.title};
    }catch(error:any){
      if(typeof error?.getStatus==='function') throw error;
      throw apiError(503,'PDF_RENDER_FAILED','PDF 渲染失败，请检查 Chromium 和中文字体安装');
    }finally{if(timer)clearTimeout(timer);await browser?.close().catch(()=>undefined);this.active--;}
  }
  private async archive(userId:string,id:string,pdf:Buffer){
    if(!process.env.S3_BUCKET || !process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY) throw apiError(503,'STORAGE_NOT_CONFIGURED','PDF 归档已开启，但对象存储未配置');
    const {S3Client,PutObjectCommand}=await import('@aws-sdk/client-s3');
    const client=new S3Client({region:process.env.S3_REGION || 'us-east-1',endpoint:process.env.S3_ENDPOINT || undefined,forcePathStyle:process.env.S3_FORCE_PATH_STYLE==='true',credentials:{accessKeyId:process.env.S3_ACCESS_KEY_ID,secretAccessKey:process.env.S3_SECRET_ACCESS_KEY}});
    try{await client.send(new PutObjectCommand({Bucket:process.env.S3_BUCKET,Key:`private/${userId}/${id}/${Date.now()}.pdf`,Body:pdf,ContentType:'application/pdf'}),{abortSignal:AbortSignal.timeout(10000)});}catch{throw apiError(503,'STORAGE_FAILED','PDF 私有归档失败，请稍后重试');}finally{client.destroy();}
  }
}
