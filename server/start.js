/**
 * server/start.js
 *
 * Reliable startup script. Run with: node start.js
 *
 * 1. Finds any process bound to PORT (default 3001)
 * 2. Kills it forcefully (taskkill on Windows)
 * 3. Waits for port to be free
 * 4. Spawns "node src/index.js" and streams its output
 *
 * This prevents the EADDRINUSE ghost-process ECONNRESET bug.
 */

import { execSync, spawn } from 'child_process';

const PORT = process.env.PORT || 3001;

function killPort(port) {
  try {
    const out = execSync('netstat -ano', { encoding: 'utf8', timeout: 3000 });
    const lines = out.split('\n');
    const pids = new Set();
    for (const line of lines) {
      const m = line.match(new RegExp(`:${port}\\s+.*LISTENING\\s+(\\d+)`));
      if (m) pids.add(parseInt(m[1]));
    }
    for (const pid of pids) {
      if (pid && pid !== process.pid) {
        try {
          execSync(`taskkill /F /PID ${pid}`, { timeout: 3000 });
          console.log(`[start] Killed stale PID ${pid} on port ${port}`);
        } catch {
          // Try SIGTERM fallback
          try { process.kill(pid); } catch {}
        }
      }
    }
    if (pids.size > 0) {
      // Wait for port to release
      return new Promise(r => setTimeout(r, 600));
    }
  } catch { /* no stale process */ }
  return Promise.resolve();
}

async function main() {
  await killPort(PORT);

  console.log(`[start] Starting Vanta server on port ${PORT}...`);

  const child = spawn('node', ['src/index.js'], {
    stdio: 'inherit',
    cwd: import.meta.dirname || process.cwd(),
    env: { ...process.env },
  });

  child.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      console.error(`[start] Server exited with code ${code}`);
    }
  });

  // Forward signals to child
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      child.kill(sig);
      process.exit(0);
    });
  }
}

main().catch(err => {
  console.error('[start] Fatal:', err.message);
  process.exit(1);
});
