import { createServer, type Server } from 'node:net';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { ClamavScanner, EICAR } from '../src/clamav';

let server: Server | undefined;
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

/** A tiny fake clamd: reads the INSTREAM framing and flags streams that contain the EICAR string. */
function fakeClamd(opts: { reply?: string; hang?: boolean } = {}): Promise<number> {
  return new Promise((resolve) => {
    server = createServer((socket) => {
      let buf = Buffer.alloc(0);
      let body = Buffer.alloc(0);
      let started = false;
      socket.on('data', (d) => {
        buf = Buffer.concat([buf, Buffer.from(d)]);
        if (!started) {
          const end = buf.indexOf(0);
          if (end === -1) return;
          expect(buf.subarray(0, end).toString()).toBe('zINSTREAM');
          buf = buf.subarray(end + 1);
          started = true;
        }
        while (buf.length >= 4) {
          const len = buf.readUInt32BE(0);
          if (len === 0) {
            if (opts.hang) return;
            const reply =
              opts.reply ??
              (body.includes(EICAR) ? 'stream: Win.Test.EICAR_HDB-1 FOUND' : 'stream: OK');
            socket.end(`${reply}\0`);
            return;
          }
          if (buf.length < 4 + len) return;
          body = Buffer.concat([body, buf.subarray(4, 4 + len)]);
          buf = buf.subarray(4 + len);
        }
      });
    }).listen(0, '127.0.0.1', () => resolve((server!.address() as { port: number }).port));
  });
}

const scannerFor = (port: number, timeoutMs = 2000) =>
  new ClamavScanner({ host: '127.0.0.1', port, timeoutMs, chunkSize: 16 });

describe('ClamavScanner', () => {
  it('reports a clean stream', async () => {
    const port = await fakeClamd();
    const result = await scannerFor(port).scan(
      Readable.from([Buffer.from('hello world, '.repeat(50))]),
    );
    expect(result).toEqual({ clean: true });
  });

  it('reports the signature of an infected stream, even when split over chunks', async () => {
    const port = await fakeClamd();
    const data = Buffer.from(`padding ${EICAR} padding`);
    const result = await scannerFor(port).scan(
      Readable.from([data.subarray(0, 30), data.subarray(30)]),
    );
    expect(result).toEqual({ clean: false, signature: 'Win.Test.EICAR_HDB-1' });
  });

  it('rejects when clamd answers with an error', async () => {
    const port = await fakeClamd({ reply: 'INSTREAM size limit exceeded. ERROR' });
    await expect(scannerFor(port).scan(Readable.from([Buffer.from('x')]))).rejects.toThrow(
      /size limit/,
    );
  });

  it('rejects when clamd is unreachable', async () => {
    await expect(scannerFor(1).scan(Readable.from([Buffer.from('x')]))).rejects.toThrow();
  });

  it('rejects when clamd stops answering', async () => {
    const port = await fakeClamd({ hang: true });
    await expect(scannerFor(port, 200).scan(Readable.from([Buffer.from('x')]))).rejects.toThrow(
      /timed out/,
    );
  });
});
