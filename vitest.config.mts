import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  configLoader: 'bundle',
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(process.cwd(), 'src') },
  },
});
