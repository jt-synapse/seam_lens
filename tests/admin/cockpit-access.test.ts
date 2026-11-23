import { beforeEach, expect, it, vi } from 'vitest';
import { AdminAuthError } from '@/modules/admin/auth';
import { importAction, loginAction, makerAction, retryAction } from '@/app/admin/actions';

const mocks = vi.hoisted(() => ({
  requireAdminUser:vi.fn(), query:vi.fn(), forbidden:vi.fn(), unauthorized:vi.fn(),
  signInWithPassword:vi.fn(), signOut:vi.fn(), redirect:vi.fn(), enqueue:vi.fn(), retry:vi.fn(),
}));
vi.mock('@/lib/db',async original => ({
  ...await original<typeof import('@/lib/db')>(),getDbPool:()=>({query:mocks.query}),
}));
vi.mock('@/modules/admin/auth',async original => ({
  ...await original<typeof import('@/modules/admin/auth')>(),requireAdminUser:mocks.requireAdminUser,
}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
vi.mock('@/modules/ingestion/chunk-worker',()=>({enqueueIngestionBatch:mocks.enqueue,retryIngestionItem:mocks.retry}));
vi.mock('next/navigation',()=>({forbidden:mocks.forbidden,unauthorized:mocks.unauthorized,redirect:mocks.redirect}));
vi.mock('@/lib/supabase/server',async original => ({
  ...await original<typeof import('@/lib/supabase/server')>(),createSupabaseServerClient:()=>({auth:mocks}),
}));
beforeEach(()=>{
  vi.resetAllMocks();
  mocks.forbidden.mockImplementation(()=>{throw new Error('HTTP 403')});
  mocks.unauthorized.mockImplementation(()=>{throw new Error('HTTP 401')});
  mocks.redirect.mockImplementation(()=>{throw new Error('Redirect')});
});

it.each([401,403] as const)('returns the %i access boundary before parsing a direct mutation',async status=>{
  mocks.requireAdminUser.mockRejectedValue(new AdminAuthError(status));
  await expect(makerAction(new FormData())).rejects.toThrow('HTTP '+status);
  expect(mocks.query).not.toHaveBeenCalled();
});

it('clears the local session when a valid password belongs to an unlisted user',async ()=>{
  mocks.signInWithPassword.mockResolvedValue({error:null});
  mocks.requireAdminUser.mockRejectedValue(new AdminAuthError(403));
  const data = new FormData();
  data.set('email','unlisted@example.com');
  data.set('password','test-only');
  expect(await loginAction(data)).toHaveProperty('error');
  expect(mocks.signOut).toHaveBeenCalledWith({scope:'local'});
  expect(mocks.redirect).not.toHaveBeenCalled();
});

it('queues a parsed CSV under the verified curator and opens its batch',async ()=>{
  const makerId = '4860f057-5aef-4d6f-a3c3-613b0c20c03f';
  const batchId = '9ad19eaf-bd74-4dbf-832e-80f20baf791b';
  mocks.requireAdminUser.mockResolvedValue({userId:'verified-curator'});
  mocks.enqueue.mockResolvedValue({batchId,itemCount:1});
  const form = new FormData();
  form.set('makerId',makerId);
  form.set('sourceType','csv_upload');
  form.set('createdBy','client-supplied');
  form.set('csv',new File(['title,product_url\nBox top,https://maker.example/top'],'pilot.csv'));
  await expect(importAction(form)).rejects.toThrow('Redirect');
  expect(mocks.enqueue.mock.calls[0][1]).toMatchObject({
    makerId,sourceType:'csv_upload',sourceDescriptor:'pilot.csv',createdBy:'verified-curator',drafts:[{title:'Box top'}],
  });
  expect(mocks.redirect).toHaveBeenCalledWith('/admin/imports?batch='+batchId);
  const itemId = '5cd19b0f-48aa-46b1-a894-83253521bfdf';
  const retry = new FormData();
  retry.set('itemId',itemId);
  expect(await retryAction(retry)).toHaveProperty('message');
  expect(mocks.retry.mock.calls[0][1]).toBe(itemId);
  expect(mocks.enqueue).toHaveBeenCalledTimes(1);
});
