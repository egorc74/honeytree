import { execFile } from 'node:child_process';

export interface ExecResult {
  stdout: string;
  stderr: string;
}

/** Runs a program without a shell. Rejects on a non-zero exit or when `timeoutMs` elapses. */
export function run(
  file: string,
  args: string[],
  opts: { timeoutMs: number },
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: opts.timeoutMs, maxBuffer: 16 * 1024 * 1024, killSignal: 'SIGKILL' },
      (err, stdout, stderr) => {
        if (err) {
          const tail = String(stderr).trim().split('\n').slice(-5).join('\n');
          reject(new Error(`${file} failed: ${err.message}\n${tail}`));
        } else {
          resolve({ stdout: String(stdout), stderr: String(stderr) });
        }
      },
    );
  });
}
