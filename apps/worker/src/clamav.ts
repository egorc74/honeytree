import { connect } from 'node:net';
import type { Readable } from 'node:stream';

export type ScanResult = { clean: true } | { clean: false; signature: string };

export interface Scanner {
  scan(stream: Readable): Promise<ScanResult>;
}

export interface ClamavOptions {
  host: string;
  port: number;
  /** Abort if clamd stays silent this long (ms). */
  timeoutMs?: number;
  /** Size of the chunks sent to clamd. */
  chunkSize?: number;
}

/**
 * Minimal clamd client using the INSTREAM command, so no shared filesystem is needed.
 * Protocol: `zINSTREAM\0`, then chunks prefixed with a 4-byte big-endian length, then a
 * zero-length chunk. clamd answers `stream: OK`, `stream: <Name> FOUND` or `... ERROR`.
 */
export class ClamavScanner implements Scanner {
  constructor(private readonly opts: ClamavOptions) {}

  scan(stream: Readable): Promise<ScanResult> {
    const { host, port, timeoutMs = 120_000, chunkSize = 64 * 1024 } = this.opts;
    return new Promise<ScanResult>((resolve, reject) => {
      const socket = connect({ host, port });
      socket.setTimeout(timeoutMs, () => fail(new Error('clamd timed out')));
      let response = '';
      let settled = false;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        stream.destroy();
        fn();
      };
      const fail = (err: Error) => finish(() => reject(err));

      socket.on('error', fail);
      socket.on('data', (d) => {
        response += d.toString('utf8');
      });
      socket.on('close', () => {
        if (settled) return;
        const text = response.replace(/\0/g, '').trim();
        const found = /^stream: (.+) FOUND$/.exec(text);
        if (text === 'stream: OK') finish(() => resolve({ clean: true }));
        else if (found) finish(() => resolve({ clean: false, signature: found[1]! }));
        else fail(new Error(`Unexpected clamd response: ${text || '(empty)'}`));
      });

      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        const send = async () => {
          for await (const chunk of stream as AsyncIterable<Buffer>) {
            for (let i = 0; i < chunk.length; i += chunkSize) {
              const part = chunk.subarray(i, i + chunkSize);
              const header = Buffer.alloc(4);
              header.writeUInt32BE(part.length);
              if (!socket.write(Buffer.concat([header, part]))) {
                await new Promise<void>((r) => socket.once('drain', () => r()));
              }
              if (settled) return;
            }
          }
          socket.write(Buffer.alloc(4)); // zero-length chunk ends the stream
        };
        send().catch(fail);
      });
    });
  }
}

/** The standard anti-virus test string. Safe to commit: it is not malware. */
export const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
