import { access, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDemoNextEnv, stageDemoApp } from '../../scripts/demo/project';

describe('local demo app isolation', () => {
  it('stages a clean copy without inheriting workspace environment files or generated Next files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'seamlens-demo-stage-test-'));
    const source = join(root, 'source');
    const staged = join(root, 'staged');
    try {
      await mkdir(staged);
      const fixtureFiles = [
        'src/app/page.tsx',
        'public/demo.webp',
        'supabase/seed/synthetic-catalog.ts',
        'eval/fixtures/smoke-v1/manifest.json',
        'tsconfig.json',
        'next.config.ts',
        'package.json',
        'bun.lock',
        '.env.local',
        '.next/server.js',
        'next-env.d.ts',
      ];
      for (const file of fixtureFiles) {
        const path = join(source, file);
        await mkdir(join(path, '..'), { recursive: true });
        await writeFile(path, file);
      }
      await mkdir(join(source, 'node_modules'));

      await stageDemoApp(source, staged);

      for (const file of fixtureFiles.slice(0, 8)) {
        await expect(readFile(join(staged, file), 'utf8')).resolves.toBe(file);
      }
      for (const file of fixtureFiles.slice(8)) {
        await expect(access(join(staged, file))).rejects.toMatchObject({ code: 'ENOENT' });
      }
      await expect(readlink(join(staged, 'node_modules'))).resolves.toBe(join(source, 'node_modules'));
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('passes only demo endpoints and credentials to Next', () => {
    const env = createDemoNextEnv(
      {
        PATH: '/fixture/bin',
        DATABASE_URL: 'postgres://external.example/prod',
        GEMINI_API_KEY: 'real-gemini-token',
        NEXT_PUBLIC_SUPABASE_URL: 'https://external.example',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'real-anon-key',
        SUPABASE_SERVICE_ROLE_KEY: 'real-service-key',
        HTTPS_PROXY: 'https://external-proxy.example',
        VERCEL: '1',
      },
      'postgres://seamlens_demo:fixture@127.0.0.1:55432/seamlens_demo',
      'http://127.0.0.1:3101',
    );

    expect(env).toMatchObject({
      PATH: '/fixture/bin',
      DATABASE_URL: 'postgres://seamlens_demo:fixture@127.0.0.1:55432/seamlens_demo',
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:3101',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'seamlens-demo-anon',
      SUPABASE_SERVICE_ROLE_KEY: 'seamlens-demo-service-role',
      SEAMLENS_LOCAL_DEMO: '1',
    });
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(env.HTTPS_PROXY).toBeUndefined();
    expect(env.VERCEL).toBeUndefined();
  });
});
