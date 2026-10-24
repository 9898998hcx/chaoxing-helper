import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Prepare the initial PostgreSQL baseline without connecting to any database.
// Existing deployed migration history is never rewritten by this helper.
const root = new URL('../', import.meta.url);
const schemaUrl = new URL('prisma/postgresql/schema.prisma', root);
const migrationDir = new URL('prisma/postgresql/migrations/20261022000000_init/', root);
async function optionalRead(url) { try { return await readFile(url, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }

async function main() {
  const source = await readFile(new URL('prisma/schema.prisma', root), 'utf8');
  if (!/provider\s*=\s*"sqlite"/.test(source)) throw new Error('Expected the local SQLite source schema.');
  const schema = source.replace(/provider\s*=\s*"sqlite"/, 'provider = "postgresql"');
  const previous = await optionalRead(schemaUrl);
  const sqlUrl = new URL('migration.sql', migrationDir);
  const existingSql = await optionalRead(sqlUrl);
  if (existingSql !== null) {
    if (previous !== schema) throw new Error('PostgreSQL schema changed after the initial baseline. Create a new versioned PostgreSQL migration; do not rewrite deployed history.');
    console.log('PostgreSQL baseline already prepared. No migration history changed.');
    return;
  }
  await mkdir(new URL('prisma/postgresql/', root), { recursive: true });
  await writeFile(schemaUrl, schema);
  const cli = fileURLToPath(new URL('node_modules/prisma/build/index.js', root));
  const result = spawnSync(process.execPath, [cli, 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', fileURLToPath(schemaUrl), '--script'], {
    cwd: fileURLToPath(root), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, DATABASE_URL: 'postgresql://schema:unused@127.0.0.1:5432/schema' },
  });
  if (result.status !== 0 || !result.stdout.trim()) throw new Error('Prisma PostgreSQL baseline generation failed. Check Prisma installation and schema validity.');
  await mkdir(migrationDir, { recursive: true });
  await writeFile(sqlUrl, result.stdout);
  await writeFile(new URL('prisma/postgresql/migrations/migration_lock.toml', root), 'provider = "postgresql"\n');
  console.log('PostgreSQL schema and initial migration prepared. No database was contacted.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
