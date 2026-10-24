import 'dotenv/config';
import { mkdir,open } from 'node:fs/promises';
import { dirname,resolve } from 'node:path';
// Some Windows engine builds cannot create the initial SQLite file. Never truncate it.
const url=process.env.DATABASE_URL || '';
if(url.startsWith('file:')){
  const path=resolve('prisma',url.slice(5).split('?')[0]);
  await mkdir(dirname(path),{recursive:true});
  const file=await open(path,'a');await file.close();
}
