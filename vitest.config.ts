import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['apps/api/**/*.test.ts', 'tests/**/*.spec.ts'], exclude: ['tests/e2e/**'], testTimeout: 15000, fileParallelism: false } });
