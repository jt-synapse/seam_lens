import { cp, mkdir, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const DEMO_SERVICE_KEY = 'seamlens-demo-service-role';

export async function stageDemoApp(source: string, destination: string) {
  // Next generates project-root typings in dev mode. This copy also keeps Next's
  // dotenv discovery and build cache away from the working tree.
  for (const entry of [
    'src', 'public', 'supabase/seed', 'eval/fixtures/smoke-v1',
    'package.json', 'bun.lock', 'next.config.ts', 'tsconfig.json',
  ]) {
    const target = join(destination, entry);
    await mkdir(dirname(target), { recursive: true });
    await cp(join(source, entry), target, { recursive: true });
  }
  await symlink(join(source, 'node_modules'), join(destination, 'node_modules'), 'junction');
}

export function createDemoNextEnv(
  inherited: Record<string, string | undefined>,
  databaseUrl: string,
  serviceUrl: string,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { NODE_ENV: 'development' };
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TZ', 'TERM']) {
    if (inherited[key] !== undefined) environment[key] = inherited[key];
  }
  return {
    ...environment,
    SEAMLENS_LOCAL_DEMO: '1',
    DATABASE_URL: databaseUrl,
    NEXT_PUBLIC_SUPABASE_URL: serviceUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'seamlens-demo-anon',
    SUPABASE_SERVICE_ROLE_KEY: DEMO_SERVICE_KEY,
    NEXT_TELEMETRY_DISABLED: '1',
  };
}
