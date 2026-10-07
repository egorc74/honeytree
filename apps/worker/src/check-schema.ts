// Usage: DATABASE_URL=... pnpm --filter @honeytree/worker check:schema
import { Pool } from 'pg';
import { checkSchema } from './schema-contract';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL to the database to check.');
  process.exit(2);
}
const pool = new Pool({ connectionString: url, max: 1 });
try {
  const problems = await checkSchema(pool);
  if (problems.length === 0) {
    console.log('Schema matches what the worker and media plugin expect.');
  } else {
    console.error(
      `${problems.length} schema problem(s) (see docs/requests/agent3-to-agent1-database-contract.md):`,
    );
    for (const p of problems)
      console.error(`  ${p.table}${p.column ? `.${p.column}` : ''}: ${p.problem}`);
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
