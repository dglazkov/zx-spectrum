// The deployed server (crates/app, Rust, on crux's parts), built and started for what runs it here: the dev server
// (vite.config.ts), which passes /archive, /zxinfo/v3 and nerd's paths through to it, and the production build's test
// (tests/build.mjs), which serves the build with it. Built with cargo into target/app, so that it waits on no other
// build's lock (cargo is incremental: a moment when nothing changed).
//
//   const app = await startApp(dir, { env });   app.url, then app.close()
import { execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('..', import.meta.url));
const target = `${repository}target/app`;

/** Builds the server, if it is missing or stale. */
export function buildApp() {
  execFileSync('cargo', ['build', '-q', '--locked', '-p', 'app'], { cwd: repository, stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, CARGO_TARGET_DIR: target } });
  return `${target}/debug/app`;
}

/**
 * The server, serving `dir` on a port of its own, once it says where it listens: its address, and how to stop it.
 * What it prints after (nerd's lines, its warnings) goes to `log`; what it says on standard error, to ours.
 */
export async function startApp(dir, { env = {}, log = (line) => console.log(line) } = {}) {
  const exe = buildApp();
  const child = spawn(exe, [dir], { env: { ...process.env, ...env, PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
  const lines = createInterface({ input: child.stdout });
  const url = await new Promise((resolve, reject) => {
    child.once('exit', (code) => reject(new Error(`the server (${exe}) stopped before it listened: ${code}`)));
    lines.once('line', (line) => {
      const port = /^listening on http:\/\/[^:]+:(\d+)$/.exec(line)?.[1];
      if (port) resolve(`http://127.0.0.1:${port}`);
      else reject(new Error(`the server said ${JSON.stringify(line)}, not where it listens`));
    });
  });
  child.removeAllListeners('exit');
  lines.on('line', log);
  const stop = () => child.kill();
  process.once('exit', stop);
  return {
    url,
    close: () =>
      new Promise((resolve) => {
        process.off('exit', stop);
        if (child.exitCode !== null) return resolve();
        child.once('exit', () => resolve());
        child.kill();
      }),
  };
}
