import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { requireAdminUser } from '@/modules/admin/auth';
import { POST } from '@/app/api/admin/ingestion/process-chunk/route';
import { middleware } from '@/middleware';

const deps = vi.hoisted(() => ({
  query: vi.fn(), getUser: vi.fn(), buildWorker: vi.fn(), process: vi.fn(), rpc: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ getDbPool: () => ({query: deps.query}) }));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({auth: {getUser: deps.getUser}}),
}));
vi.mock('@supabase/ssr', () => ({createServerClient: () => ({auth:{getUser:deps.getUser},rpc:deps.rpc})}));
vi.mock('@/modules/ingestion/production', () => ({createIngestionWorkerDeps: deps.buildWorker}));
vi.mock('@/modules/ingestion/chunk-worker', () => ({processNextIngestionChunk: deps.process}));

const id = 'b38be87a-729a-41c0-a75b-efdd0b35529b';
const request = (body: unknown) => new Request('https://seam.example/api/admin/ingestion/process-chunk', {
  method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body),
});
function signIn(allowed: boolean) {
  deps.getUser.mockResolvedValue({data:{user:{id}},error:null});
  deps.query.mockResolvedValue({rows:allowed ? [{user_id:id,email:'curator@example.test',role:'curator'}] : []});
  deps.rpc.mockResolvedValue({data:allowed,error:null});
}
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

it('requires a verified identity before querying the Node allowlist or constructing privileged clients', async () => {
  deps.getUser.mockResolvedValue({data:{user:null},error:{name:'AuthSessionMissingError'}});
  expect((await POST(request({batchId:id}))).status).toBe(401);
  expect(deps.query).not.toHaveBeenCalled();
  signIn(false);
  expect((await POST(request({batchId:id,userId:id}))).status).toBe(403);
  expect(deps.query.mock.calls[0][1]).toEqual([id]);
  expect(deps.buildWorker).not.toHaveBeenCalled();
  expect(deps.process).not.toHaveBeenCalled();
});

it('passes the allowlisted user and only a valid batch and bounded chunk to the worker', async () => {
  signIn(true);
  expect(await requireAdminUser({query:deps.query})).toEqual({userId:id,email:'curator@example.test',role:'curator'});
  expect((await POST(request({batchId:id,chunkSize:4}))).status).toBe(400);
  expect((await POST(request({batchId:'wrong'}))).status).toBe(400);
  expect(deps.buildWorker).not.toHaveBeenCalled();
  const worker = { db: {query:deps.query} };
  const progress = {processed:1,completed:1,failed:0,status:'completed'};
  deps.buildWorker.mockReturnValue(worker);
  deps.process.mockResolvedValue(progress);
  const response = await POST(request({batchId:id}));
  expect(await response.json()).toEqual(progress);
  expect(deps.process).toHaveBeenCalledWith(worker,id,3);
  expect(response.headers.get('cache-control')).toContain('no-store');
});

it('checks sessions on admin pages and APIs while keeping login reachable', async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://auth.example.test');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY','test-key');
  const req = (path: string) => new NextRequest('https://seam.example'+path);
  expect((await middleware(req('/admin/login'))).status).toBe(200);
  expect(deps.getUser).not.toHaveBeenCalled();
  deps.getUser.mockResolvedValue({data:{user:null},error:null});
  expect((await middleware(req('/admin/patterns'))).headers.get('location')).toBe('https://seam.example/admin/login');
  expect((await middleware(req('/api/admin/ingestion/process-chunk'))).status).toBe(401);
  signIn(false);
  expect((await middleware(req('/admin/imports'))).status).toBe(403);
  signIn(true);
  expect((await middleware(req('/admin/makers'))).headers.get('x-middleware-next')).toBe('1');
  deps.rpc.mockResolvedValue({data:null,error:{message:'DB unavailable'}});
  expect((await middleware(req('/admin/telemetry'))).status).toBe(503);
});

it('exposes only the current authenticated membership through the Edge allowlist function', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $q$ SELECT current_setting('request.jwt.claim.sub',true)::uuid $q$;
      CREATE TABLE admin_users(user_id uuid PRIMARY KEY);
      INSERT INTO admin_users VALUES ('${id}');`);
    await db.exec(await readFile('supabase/migrations/202611220006_admin_membership.sql','utf8'));
    await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub='${id}'`);
    expect((await db.query('SELECT public.is_seamlens_admin() AS admin')).rows).toEqual([{admin:true}]);
    await db.exec("SET request.jwt.claim.sub='c6de315b-3e66-4398-a6ae-6553ba075ce4'");
    expect((await db.query('SELECT public.is_seamlens_admin() AS admin')).rows).toEqual([{admin:false}]);
    await expect(db.query('SELECT * FROM admin_users')).rejects.toThrow(/permission denied/);
    await db.exec('RESET ROLE; SET ROLE anon');
    await expect(db.query('SELECT public.is_seamlens_admin()')).rejects.toThrow(/permission denied/);
  } finally { await db.close(); }
});
