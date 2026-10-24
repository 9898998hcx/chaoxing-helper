import { test,expect } from '@playwright/test';

test('register, edit, reference template, AI preview/accept, download and delete',async({page},testInfo)=>{
  await page.goto('/register');
  await page.getByLabel('邮箱',{exact:true}).fill(`e2e-${testInfo.project.name}-${Date.now()}@example.com`);
  await page.getByLabel('密码',{exact:true}).fill('Valid-pass-2026');
  const confirm=page.getByLabel('确认密码',{exact:true});if(await confirm.count())await confirm.fill('Valid-pass-2026');
  await page.getByRole('button',{name:'创建账户',exact:true}).click();
  await expect(page).toHaveURL(/\/resumes/);
  await page.getByRole('button',{name:'新建简历',exact:false}).first().click();
  await page.getByLabel('简历名称',{exact:true}).fill('端到端测试简历');
  await page.getByRole('button',{name:'创建并编辑'}).click();
  await expect(page).toHaveURL(/\/resumes\/[^/]+$/);
  await page.getByLabel('姓名',{exact:true}).fill('李明');
  await expect(page.getByText('✓ 所有修改已保存',{exact:false})).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('姓名',{exact:true})).toHaveValue('李明');
  await page.getByRole('button',{name:'下移基本信息'}).click();
  await expect(page.getByText('✓ 所有修改已保存',{exact:false})).toBeVisible();
  if(testInfo.project.name==='mobile'){
    await page.getByRole('tab',{name:'实时预览'}).click();
    await expect(page.getByRole('heading',{name:'李明',exact:true})).toBeVisible();
    await page.getByRole('tab',{name:'编辑内容'}).click();
  }
  await page.route('**/api/ai/quota',route=>route.fulfill({json:{configured:true,remaining:20,dailyLimit:20,resetAt:new Date().toISOString()}}));
  await page.route('**/api/ai/settings',route=>route.fulfill({json:{configured:false,maskedKey:null}}));
  await page.route('**/api/ai/generate',route=>route.fulfill({json:{generationId:'mock-preview',scenario:'summary',result:{sectionType:'summary',items:[{description:'仅在采纳后写入的求职自评'}],suggestions:['请核实所有事实']},quota:{remaining:19,dailyLimit:20}}}));
  const id=new URL(page.url()).pathname.split('/').at(-1);
  await page.getByRole('link',{name:'结构参考',exact:true}).click();
  await page.getByRole('link',{name:'专业履历',exact:true}).click();
  await page.getByLabel('应用到哪份简历').selectOption(id!);
  await page.getByRole('button',{name:'使用此结构生成',exact:true}).click();
  await expect(page).toHaveURL(new RegExp(`/resumes/${id}\\?ai=1`));
  const referenced=await(await page.request.get(`/api/resumes/${id}`)).json();
  expect(referenced.resume.templateId).toBeTruthy();
  expect(referenced.resume.sections.map((s:any)=>s.type).slice(0,3)).toEqual(['basic','intent','work']);
  expect(referenced.resume.sections.find((s:any)=>s.type==='basic').content[0].name).toBe('李明');
  await page.getByLabel('你想做什么').selectOption('summary');
  await page.getByLabel('你的真实经历').fill('三年软件开发经验');
  await page.getByRole('button',{name:'生成并预览'}).click();
  await expect(page.getByText('生成内容预览',{exact:true})).toBeVisible();
  let stored=await page.request.get(`/api/resumes/${id}`);
  expect(JSON.stringify(await stored.json())).not.toContain('仅在采纳后写入的求职自评');
  await page.getByRole('button',{name:'采纳到自我评价'}).click();
  await page.getByRole('button',{name:'关闭 AI 助手',exact:true}).last().click();
  await expect(page.getByText('✓ 所有修改已保存',{exact:false})).toBeVisible();
  stored=await page.request.get(`/api/resumes/${id}`);
  expect(JSON.stringify(await stored.json())).toContain('仅在采纳后写入的求职自评');
  const downloadPromise=page.waitForEvent('download',{timeout:45000});
  await page.getByRole('button',{name:'下载 PDF',exact:true}).click();
  const download=await downloadPromise;expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  await download.saveAs(`artifacts/resume-${testInfo.project.name}.pdf`);
  await page.screenshot({path:`artifacts/editor-${testInfo.project.name}.png`,fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByRole('button',{name:'‹ 我的简历'}).click();
  await page.getByRole('button',{name:'删除',exact:true}).first().click();
  await page.getByRole('button',{name:'删除简历',exact:true}).click();
  await expect(page.getByRole('link',{name:'端到端测试简历',exact:true})).toHaveCount(0);
});

test('public template catalog and accessible login',async({page})=>{
  await page.goto('/templates');await expect(page.getByRole('heading',{level:1})).toBeVisible();
  await expect(page.getByText('专业履历',{exact:true}).first()).toBeVisible();
  await page.goto('/login');await page.getByLabel('邮箱',{exact:true}).fill('invalid@example.com');
  await page.getByLabel('密码',{exact:true}).fill('Wrong-pass-2026');
  await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();
});
