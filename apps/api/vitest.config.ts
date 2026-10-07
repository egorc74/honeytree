import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    fileParallelism: false, // all files share one test database
    testTimeout: 20_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://honeytree:honeytree@localhost:5432/honeytree_test',
      RATE_LIMIT_ENABLED: 'false',
      REDIS_URL: '',
      WEB_ORIGINS: 'http://localhost:3000',
      API_PUBLIC_URL: 'http://localhost:4000',
      MEDIA_PUBLIC_BASE_URL: 'http://localhost:9000/honeytree',
    },
  },
});
