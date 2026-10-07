import { execSync } from 'node:child_process';

/** Applies the migrations to the test database once, before any test file runs. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://honeytree:honeytree@localhost:5432/honeytree_test';
  execSync('npx prisma migrate deploy', {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
