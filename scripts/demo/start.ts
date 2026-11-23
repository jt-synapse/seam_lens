import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { seedSyntheticCatalog } from '../../supabase/seed/synthetic-catalog';
import { createDemoNextEnv, DEMO_SERVICE_KEY, stageDemoApp } from './project';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const host = '127.0.0.1';
const dbName = 'seamlens_demo';
const image = 'pgvector/pgvector:pg16';
const admin = {
  id: 'c7c3a52b-6d07-4adb-adc8-41e1d91b17a8',
  email: 'curator@seamlens.demo',
  password: 'seamlens-demo',
};

function readPort(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const port = Number(value);
  if (!/^\d+$/.test(value) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be a port from 1 to 65535.`);
  }
  return port;
}

async function getLocalDockerHost(): Promise<string> {
  try {
    const endpoint = (process.env.DOCKER_CONTEXT ? undefined : process.env.DOCKER_HOST)
      || (await exec('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'],
        { timeout: 5000 })).stdout.trim();
    if (new URL(endpoint).protocol === 'unix:') return endpoint;
  } catch (error) {
    throw new Error('Install Docker and start its local engine, then retry bun run demo.', { cause: error });
  }
  throw new Error('Select a Docker context backed by a local Unix socket, then retry bun run demo.');
}

async function prepareDatabase(databaseUrl: string, signal: AbortSignal) {
  const pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 1000,
    statement_timeout: 15_000,
    ssl: false,
  });
  try {
    const deadline = Date.now() + 45_000;
    for (;;) {
      signal.throwIfAborted();
      try {
        await pool.query('SELECT 1');
        break;
      } catch (error) {
        if (Date.now() >= deadline) {
          throw new Error('The demo PostgreSQL container did not become ready.', { cause: error });
        }
        await delay(250, undefined, { signal });
      }
    }

    const dir = join(root, 'supabase', 'migrations');
    for (const file of (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort()) {
      signal.throwIfAborted();
      await pool.query(await readFile(join(dir, file), 'utf8'));
    }
    signal.throwIfAborted();
    const counts = await seedSyntheticCatalog(pool);
    await pool.query(
      'INSERT INTO admin_users (user_id, email, role) VALUES ($1, $2, $3)',
      [admin.id, admin.email, 'curator'],
    );
    console.log(`Loaded the synthetic catalog (${counts.patternCount} patterns).`);
  } finally {
    await pool.end();
  }
}

function waitForExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', resolveExit);
  });
}

async function stopNext(child: ChildProcess, exit: Promise<number | null>) {
  const { pid } = child;
  if (pid === undefined) return;
  const signalGroup = (signal: NodeJS.Signals) => {
    try {
      process.kill(-pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  };
  signalGroup('SIGTERM');
  await Promise.race([exit.catch(() => null), delay(2500, undefined, { ref: false })]);
  signalGroup('SIGKILL');
}

async function waitForApp(appUrl: string, signal: AbortSignal) {
  const deadline = Date.now() + 150_000;
  for (;;) {
    signal.throwIfAborted();
    const response = await fetch(appUrl, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)]),
      redirect: 'manual',
    }).catch(() => undefined);
    if (response) {
      await response.body?.cancel();
      if (response.ok) return;
      throw new Error(`The demo application returned HTTP ${response.status}. See the Next.js output above.`);
    }
    if (Date.now() >= deadline) throw new Error('The demo application did not become ready.');
    await delay(250, undefined, { signal });
  }
}

async function main() {
  const appPort = readPort('SEAMLENS_DEMO_PORT', 3100);
  const servicePort = readPort('SEAMLENS_DEMO_SERVICE_PORT', 3101);
  if (appPort === servicePort) throw new Error('The demo app and guide need different ports.');
  // Next middleware canonicalizes loopback redirects to localhost. Keep curator cookies on that origin.
  const appUrl = `http://localhost:${appPort}`;

  const stop = new AbortController();
  const interrupt = () => stop.abort();
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  const { signal } = stop;

  const container = `seamlens-demo-${randomUUID()}`;
  let containerRequested = false;
  let directory: string | undefined;
  let services: { close(): Promise<void> } | undefined;
  let next: ChildProcess | undefined;
  let nextExit: Promise<number | null> | undefined;
  const dockerHost = await getLocalDockerHost();
  const dockerEnv = { ...process.env, DOCKER_CONTEXT: undefined, DOCKER_HOST: undefined };
  const docker = (args: string[], timeout = 30_000, signal?: AbortSignal) =>
    exec('docker', ['--host', dockerHost, ...args], { env: dockerEnv, timeout, signal });

  try {
    await docker(['info', '--format', '{{.ServerVersion}}'], 5000, signal).catch((error) => {
      throw new Error('Start the local Docker engine and ensure you can run docker info, then retry bun run demo.',
        { cause: error });
    });

    const { startDemoServices } = await import('./services');
    const localServices = await startDemoServices({ appUrl, port: servicePort, admin, serviceRoleKey: DEMO_SERVICE_KEY });
    services = localServices;
    signal.throwIfAborted();

    if (!await docker(['image', 'inspect', image], 5000, signal).then(() => true, () => false)) {
      console.log(`Downloading ${image} for the one-time demo setup…`);
      await docker(['pull', image], 300_000, signal);
    }
    signal.throwIfAborted();
    console.log('Starting a temporary PostgreSQL 16 database…');
    const dbPassword = randomBytes(24).toString('hex');
    containerRequested = true;
    await docker([
      'run', '--detach', '--rm', '--pull=never', '--name', container,
      '--publish', `${host}::5432`, '--tmpfs', '/var/lib/postgresql/data',
      '--env', `POSTGRES_USER=${dbName}`, '--env', `POSTGRES_DB=${dbName}`,
      '--env', `POSTGRES_PASSWORD=${dbPassword}`, image,
    ]);
    signal.throwIfAborted();
    const { stdout } = await docker(['port', container, '5432/tcp'], 5000, signal);
    const dbPort = /^127\.0\.0\.1:(\d+)$/.exec(stdout.trim())?.[1];
    if (!dbPort) throw new Error('Docker did not assign a loopback port for the demo database.');
    const databaseUrl = `postgresql://${dbName}:${dbPassword}@${host}:${dbPort}/${dbName}`;
    await prepareDatabase(databaseUrl, signal);

    directory = await mkdtemp(join(tmpdir(), 'seamlens-demo-'));
    await stageDemoApp(root, directory);
    signal.throwIfAborted();
    next = spawn(process.execPath, [
      '--no-env-file', join(root, 'node_modules', 'next', 'dist', 'bin', 'next'),
      'dev', '--hostname', host, '--port', String(appPort),
    ], {
      cwd: directory,
      detached: true,
      env: createDemoNextEnv(process.env, databaseUrl, localServices.url),
      stdio: 'inherit',
    });
    nextExit = waitForExit(next);
    const unexpectedExit = nextExit.then((code) => {
      if (!signal.aborted) {
        throw new Error(`The demo application exited (status ${code ?? 'signal'}). Check port ${appPort} and the output above.`);
      }
    });
    await Promise.race([waitForApp(`http://${host}:${appPort}`, signal), unexpectedExit]);
    signal.throwIfAborted();
    console.log(`\nDemo guide   ${localServices.url}/\nSeamLens     ${appUrl}/`);
    console.log(`Curator      ${admin.email} / ${admin.password}\nPress Ctrl+C to stop the demo and discard its data.\n`);
    await Promise.race([
      unexpectedExit,
      new Promise<void>((resolveStop) => signal.addEventListener('abort', () => resolveStop(), { once: true })),
    ]);
  } catch (error) {
    if (!signal.aborted) throw error;
  } finally {
    stop.abort();
    const cleanup = await Promise.allSettled([
      next && nextExit ? stopNext(next, nextExit) : undefined,
      services?.close(),
      containerRequested ? docker(['rm', '--force', '--volumes', container], 15_000).catch((error) => {
        if (!String(error.stderr).includes('No such container')) throw error;
      }) : undefined,
    ]);
    if (directory) await rm(directory, { recursive: true, force: true });
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
    for (const result of cleanup) {
      if (result.status === 'rejected') throw result.reason;
    }
  }
}

main().catch((error: unknown) => {
  console.error(`SeamLens demo failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
