import { afterAll, describe, expect, it } from 'vitest';
import { openTestDb } from '@honeytree/media/testing';
import { checkSchema } from '../src/schema-contract';

describe('checkSchema', () => {
  it('accepts the schema the tests use, and reports what is missing or mistyped', async () => {
    const t = await openTestDb();
    afterAll(() => t.close());
    // PGlite has no `current_schema()` surprises, but keep the check honest on both engines.
    expect(await checkSchema(t.db)).toEqual([]);

    await t.db.query(`ALTER TABLE media DROP COLUMN sort_order`);
    await t.db.query(`ALTER TABLE media ALTER COLUMN size_bytes TYPE integer`);
    await t.db.query(`ALTER TABLE game_scores DROP CONSTRAINT game_scores_pkey`);
    await t.db.query(`DROP TABLE downloads`);
    const problems = (await checkSchema(t.db)).map((p) => `${p.table}.${p.column ?? '*'}`).sort();
    expect(problems).toEqual([
      'downloads.*',
      'game_scores.game_id',
      'media.size_bytes',
      'media.sort_order',
    ]);
  });
});
