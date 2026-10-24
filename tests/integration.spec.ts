import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { INestApplication } from '@nestjs/common';
import { initialSections } from '@resume/shared';
import { AppModule } from '../apps/api/src/app.module.js';
import { ApiExceptionFilter } from '../apps/api/src/common/errors.js';
import { PrismaService } from '../apps/api/src/common/prisma.service.js';

describe('SQLite HTTP integration: sessions, ownership, snapshots and failures',()=>{
  let app:INestApplication;
  let server:any;
  let ownerCookie:string,otherCookie:string,ownerCsrf:string,otherCsrf:string,resumeId:string;
  const origin='http://localhost:3000';
  const email=`owner-${Date.now()}@example.com`;
  const oldEnv={...process.env};
  beforeAll(async()=>{
    await mkdir(resolve('artifacts'),{recursive:true});
    const dbPath=resolve('artifacts',`integration-${Date.now()}.db`);
    await writeFile(dbPath,'',{flag:'wx'});
    process.env.DATABASE_URL=`file:${dbPath.replace(/\\/g,'/')}`;
    process.env.APP_ORIGIN=origin;process.env.EMAIL_VERIFICATION_REQUIRED='false';process.env.REDIS_URL='memory://';process.env.DEEPSEEK_API_KEY='';process.env.USER_SECRET_ENCRYPTION_KEY='11'.repeat(32);process.env.CRAWLER_ENABLED='false';process.env.NODE_ENV='test';
    execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{cwd:resolve('.'),env:process.env,stdio:'pipe',timeout:30000});
    app=await NestFactory.create(AppModule,{logger:false,bodyParser:false});
    app.setGlobalPrefix('api');app.use(json({limit:'500kb'}));app.use(cookieParser());app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();server=app.getHttpServer();
  },45000);
  afterAll(async()=>{await app?.close();for(const key of Object.keys(process.env))if(!(key in oldEnv))delete process.env[key];Object.assign(process.env,oldEnv);});
  it('registers securely and restores a session; duplicate email and wrong password fail',async()=>{
    const registered=await request(server).post('/api/auth/register').set('Origin',origin).send({email,password:'Valid-pass-2026'}).expect(201);
    expect(registered.body).not.toHaveProperty('token');expect(registered.body.user).not.toHaveProperty('passwordHash');
    ownerCookie=registered.headers['set-cookie'][0].split(';')[0];ownerCsrf=registered.body.csrfToken;
    expect(registered.headers['set-cookie'][0]).toContain('HttpOnly');
    await request(server).get('/api/auth/me').set('Cookie',ownerCookie).expect(200).expect(r=>expect(r.body.user.email).toBe(email));
    await request(server).post('/api/auth/register').set('Origin',origin).send({email,password:'Valid-pass-2026'}).expect(409);
    await request(server).post('/api/auth/login').set('Origin',origin).send({email,password:'Wrong-pass-2026'}).expect(401);
    const other=await request(server).post('/api/auth/register').set('Origin',origin).send({email:`other-${email}`,password:'Valid-pass-2026'}).expect(201);
    otherCookie=other.headers['set-cookie'][0].split(';')[0];otherCsrf=other.body.csrfToken;
  });
  it('rejects unauthenticated, wrong-origin and missing-CSRF mutations',async()=>{
    await request(server).get('/api/resumes').expect(401);
    await request(server).post('/api/resumes').set('Cookie',ownerCookie).set('Origin',origin).send({title:'test'}).expect(403);
    await request(server).post('/api/resumes').set('Cookie',ownerCookie).set('x-csrf-token',ownerCsrf).set('Origin','https://evil.example').send({title:'test'}).expect(403);
  });
  it('creates, autosaves, reloads and detects stale revisions',async()=>{
    const created=await request(server).post('/api/resumes').set('Cookie',ownerCookie).set('Origin',origin).set('x-csrf-token',ownerCsrf).send({title:'软件工程师简历'}).expect(201);
    resumeId=created.body.resume.id;
    const sections=created.body.resume.sections;sections[0].content[0].name='张三';
    const saved=await request(server).patch(`/api/resumes/${resumeId}`).set('Cookie',ownerCookie).set('Origin',origin).set('x-csrf-token',ownerCsrf).send({title:'软件工程师简历',sections,revision:1}).expect(200);
    expect(saved.body.resume.revision).toBe(2);
    await request(server).get(`/api/resumes/${resumeId}`).set('Cookie',ownerCookie).expect(200).expect(r=>expect(r.body.resume.sections[0].content[0].name).toBe('张三'));
    await request(server).patch(`/api/resumes/${resumeId}`).set('Cookie',ownerCookie).set('Origin',origin).set('x-csrf-token',ownerCsrf).send({title:'stale',sections,revision:1}).expect(409);
    const versions=await request(server).get(`/api/resumes/${resumeId}/versions`).set('Cookie',ownerCookie).expect(200);
    expect(versions.body.versions).toHaveLength(2);
    const first=versions.body.versions.find((x:any)=>x.revision===1);
    await request(server).post(`/api/resumes/${resumeId}/versions/${first.id}/restore`).set('Cookie',ownerCookie).set('Origin',origin).set('x-csrf-token',ownerCsrf).send({revision:2}).expect(201).expect(r=>expect(r.body.resume.revision).toBe(3));
  });
  it('isolates read, write, duplicate, history, PDF and delete across users',async()=>{
    for(const [method,path] of [['get',''],['patch',''],['post','/duplicate'],['get','/versions'],['post','/pdf'],['delete','']] as const){
      let req=(request(server) as any)[method](`/api/resumes/${resumeId}${path}`).set('Cookie',otherCookie).set('Origin',origin).set('x-csrf-token',otherCsrf);
      if(method==='patch')req=req.send({title:'foreign',sections:initialSections(),revision:3});
      if(path==='/pdf')req=req.send({style:'clean'});
      await req.expect(404);
    }
    await request(server).get('/api/resumes').set('Cookie',otherCookie).expect(200).expect(r=>expect(r.body.resumes).toHaveLength(0));
  });
  it('maps missing AI key to a safe error and logs no private content',async()=>{
    await request(server).post('/api/ai/generate').set('Cookie',ownerCookie).set('Origin',origin).set('x-csrf-token',ownerCsrf).send({resumeId,scenario:'summary',experience:'secret-private-personal-data'}).expect(503);
    const logs=await app.get(PrismaService).aiGenerationLog.findMany();
    expect(JSON.stringify(logs)).not.toContain('secret-private-personal-data');
  });
  it('protects BYOK settings, masks responses, and rejects unauthenticated access',async()=>{
    await request(server).get('/api/ai/settings').expect(401);
    await request(server).put('/api/ai/settings').set('Origin',origin).send({apiKey:'sk-integration-secret-1234'}).expect(401);
    await request(server).put('/api/ai/settings').set('Cookie',ownerCookie).set('Origin',origin).set('x-csrf-token',ownerCsrf).send({apiKey:'sk-integration-secret-1234'}).expect(200).expect(r=>expect(r.body).toEqual({configured:true,maskedKey:'sk-****1234'}));
    const prisma=app.get(PrismaService);
    const owner=await prisma.user.findUniqueOrThrow({where:{email}});
    const saved=await prisma.user.findUniqueOrThrow({where:{id:owner.id},select:{customDeepseekKey:true}});
    expect(saved.customDeepseekKey).toBeTruthy();
    expect(saved.customDeepseekKey).not.toContain('sk-integration-secret-1234');
    await request(server).get('/api/ai/settings').set('Cookie',ownerCookie).expect(200).expect(r=>expect(r.body).toEqual({configured:true,maskedKey:'sk-****1234'}));
    await request(server).put('/api/ai/settings').set('Cookie',ownerCookie).set('Origin',origin).set('x-csrf-token',ownerCsrf).send({apiKey:null}).expect(200).expect(r=>expect(r.body).toEqual({configured:false,maskedKey:null}));
    const cleared=await prisma.user.findUniqueOrThrow({where:{id:owner.id},select:{customDeepseekKey:true}});
    expect(cleared.customDeepseekKey).toBeNull();
  });
  it('keeps crawler disabled and rejects ordinary admin access',async()=>{
    await request(server).get('/api/admin/sources').set('Cookie',ownerCookie).expect(403);
    expect(await app.get(PrismaService).templateSource.count()).toBe(0);
  });
  it('publishes only approved templates and removes taken-down entries immediately',async()=>{
    const prisma=app.get(PrismaService);
    const owner=await prisma.user.findUniqueOrThrow({where:{email}});
    await prisma.user.update({where:{id:owner.id},data:{role:'ADMIN'}});
    const template=await prisma.template.create({data:{title:'审核结构测试',slug:'review-integration',description:'自有测试结构',tags:['技术'],style:'clean',layout:'single-column',sectionOrder:['basic','work','summary'],status:'PENDING'}});
    await request(server).get(`/api/templates/${template.id}`).expect(404);
    await request(server).patch(`/api/admin/templates/${template.id}`).set('Cookie',ownerCookie).set('Origin',origin).set('x-csrf-token',ownerCsrf).send({status:'APPROVED',reviewNote:'确认仅为原创元数据'}).expect(200);
    await request(server).get(`/api/templates/${template.id}`).expect(200);
    const recommendations=await request(server).get('/api/templates/recommendations?role=技术').expect(200);
    expect(recommendations.body.templates.some((x:any)=>x.id===template.id)).toBe(true);
    await request(server).patch(`/api/admin/templates/${template.id}`).set('Cookie',ownerCookie).set('Origin',origin).set('x-csrf-token',ownerCsrf).send({status:'TAKEN_DOWN',reviewNote:'根据测试下架请求立即下架'}).expect(200);
    await request(server).get(`/api/templates/${template.id}`).expect(404);
    const listing=await request(server).get('/api/templates').expect(200);
    expect(listing.body.templates.some((x:any)=>x.id===template.id)).toBe(false);
    expect(await prisma.auditLog.count()).toBeGreaterThanOrEqual(2);
  });
  it('renders a multi-page Chinese PDF with a safe download filename',async()=>{
    const sections=initialSections();sections[0].content[0]={name:'张三 中文字体验收',phone:'13800000000',email:'zhang@example.com',city:'上海'};
    sections[3].content=Array.from({length:20},(_,i)=>({company:`中文科技公司 ${i}`,role:'软件工程师',start:'2023',end:'2026',description:'负责系统架构设计与功能开发，提升服务稳定性。\n'.repeat(5)}));
    await request(server).patch(`/api/resumes/${resumeId}`).set('Cookie',ownerCookie).set('Origin',origin).set('x-csrf-token',ownerCsrf).send({title:'中文 PDF 验收',sections,revision:3}).expect(200);
    const result=await request(server).post(`/api/resumes/${resumeId}/pdf`).set('Cookie',ownerCookie).set('Origin',origin).set('x-csrf-token',ownerCsrf).send({style:'professional'}).buffer(true).parse((res,cb)=>{const chunks:Buffer[]=[];res.on('data',x=>chunks.push(x));res.on('end',()=>cb(null,Buffer.concat(chunks)));}).expect(200);
    expect(result.headers['content-type']).toContain('application/pdf');expect(result.headers['content-disposition']).toContain('filename*=UTF-8');
    expect(result.body.subarray(0,5).toString()).toBe('%PDF-');
    expect(result.body.toString('latin1')).toContain('/ToUnicode');
    await writeFile(resolve('artifacts','integration-multipage.pdf'),result.body);
    const pages=(result.body.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length;
    expect(pages).toBeGreaterThan(1);
  },45000);
  it('invalidates session on logout',async()=>{
    await request(server).post('/api/auth/logout').set('Cookie',ownerCookie).set('Origin',origin).set('x-csrf-token',ownerCsrf).expect(201);
    await request(server).get('/api/auth/me').set('Cookie',ownerCookie).expect(401);
  });
});
