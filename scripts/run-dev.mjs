// Starts every workspace package that defines a `dev` script, in parallel.
// Environment variables from `.env` are loaded by `node --env-file-if-exists`
// (see the root `dev` script), so every child process inherits them.
import { spawn } from 'node:child_process';

const child = spawn('pnpm', ['-r', '--parallel', '--if-present', 'run', 'dev'], {
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', (code) => process.exit(code ?? 0));
