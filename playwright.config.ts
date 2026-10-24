import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
export default defineConfig({
  testDir:'./tests/e2e',timeout:60000,expect:{timeout:12000},fullyParallel:false,workers:1,
  reporter:[['list'],['html',{open:'never'}]],
  use:{baseURL:'http://localhost:3000',trace:'retain-on-failure',screenshot:'only-on-failure',launchOptions:process.platform==='win32'&&existsSync(edge)?{executablePath:edge}:{}},
  projects:[{name:'desktop',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:1000}}},{name:'mobile',use:{...devices['iPhone 13'],defaultBrowserType:'chromium'}}],
  webServer:{command:'npm run dev',url:'http://localhost:3000',timeout:120000,reuseExistingServer:!process.env.CI,env:{APP_ORIGIN:'http://localhost:3000',API_HOST:'127.0.0.1',EMAIL_VERIFICATION_REQUIRED:'false'}},
});
