import { buildApp } from './app.ts';
import { config } from './config.ts';
import { prisma } from './db.ts';
import { closeRedis } from './redis.ts';

const app = await buildApp();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    await prisma.$disconnect();
    await closeRedis();
    process.exit(0);
  });
}

await app.listen({ host: config.host, port: config.port });
