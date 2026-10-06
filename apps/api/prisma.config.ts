import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  // `prisma generate` does not connect, so it must work on a fresh checkout without a .env.
  datasource: { url: process.env.DATABASE_URL ?? 'postgresql://unset:unset@localhost:5432/unset' },
});
