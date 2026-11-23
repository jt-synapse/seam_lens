import { afterEach, expect, it, vi } from 'vitest';
import { isLocalDemo, demoMakerDestination } from '@/lib/local-demo';

afterEach(() => vi.unstubAllEnvs());

function localEnvironment() {
  vi.stubEnv('SEAMLENS_LOCAL_DEMO', '1');
  vi.stubEnv('DATABASE_URL', 'postgres://curator:fixture@127.0.0.1:55432/seamlens_demo');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:3101');
  vi.stubEnv('VERCEL', undefined);
}

it('enables simulation only for the dedicated local database and service', () => {
  localEnvironment();
  expect(isLocalDemo()).toBe(true);
  for (const database of ['postgres://curator@internal.example/seamlens_demo', 'postgres://localhost/real_catalog']) {
    vi.stubEnv('DATABASE_URL', database);
    expect(() => isLocalDemo()).toThrow(/local/i);
  }
  localEnvironment();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
  expect(() => isLocalDemo()).toThrow(/local/i);
  localEnvironment();
  vi.stubEnv('VERCEL','1');
  expect(() => isLocalDemo()).toThrow(/local/i);
  vi.stubEnv('SEAMLENS_LOCAL_DEMO', undefined);
  expect(isLocalDemo()).toBe(false);
});

it('keeps the selected title, maker and size band on the local maker preview', () => {
  localEnvironment();
  const preview = new URL(demoMakerDestination('Maison & Co.', 'Cowl / dress', 'Curve'));
  expect(preview.origin + preview.pathname).toBe('http://127.0.0.1:3101/maker');
  expect(Object.fromEntries(preview.searchParams)).toEqual({maker:'Maison & Co.', product:'Cowl / dress', band:'Curve'});
});
