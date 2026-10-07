import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.ts';
import { notFound } from '../errors.ts';

const PALETTE = ['#F5B700', '#FFD45C', '#D98E04', '#FDEBB3', '#6B4226', '#3B2414'];

/** Deterministic honeycomb image for seed data (`placeholder:<name>` media keys). */
function placeholderSvg(name: string): string {
  const h = createHash('sha256').update(name).digest();
  const bg = PALETTE[h[0]! % 4]!;
  const ink = PALETTE[4 + (h[1]! % 2)]!;
  const size = 46;
  const dx = size * Math.sqrt(3);
  let cells = '';
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 9; col++) {
      const cx = col * dx + (row % 2 ? dx / 2 : 0);
      const cy = row * size * 1.5;
      const opacity = 0.08 + (h[(row * 9 + col) % h.length]! / 255) * 0.35;
      const pts = Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i + Math.PI / 6;
        return `${(cx + (size - 3) * Math.cos(a)).toFixed(1)},${(cy + (size - 3) * Math.sin(a)).toFixed(1)}`;
      }).join(' ');
      cells += `<polygon points="${pts}" fill="${ink}" fill-opacity="${opacity.toFixed(2)}"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400" width="640" height="400"><rect width="640" height="400" fill="${bg}"/>${cells}</svg>`;
}

export default async function systemRoutes(app: FastifyInstance) {
  app.get('/healthz', async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { ok: true };
    } catch {
      return reply.status(503).send({ ok: false });
    }
  });

  app.get('/placeholders/:file', async (req, reply) => {
    const { file } = req.params as { file: string };
    const m = /^([a-z0-9_-]{1,60})\.svg$/i.exec(file);
    if (!m) throw notFound('Image');
    return reply
      .header('Content-Type', 'image/svg+xml')
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .send(placeholderSvg(m[1]!));
  });
}
