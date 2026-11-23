// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import BatchRunner from '@/app/admin/imports/BatchRunner';

const router = vi.hoisted(()=>({refresh:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>router}));
afterEach(()=>{
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('polls one chunk at a time, resumes a transient failure and stops on completion',async ()=>{
  vi.useFakeTimers();
  const request = vi.fn()
    .mockResolvedValueOnce({ok:false,status:503})
    .mockResolvedValueOnce({ok:true,json:async()=>({status:'processing',processed:3})})
    .mockResolvedValueOnce({ok:true,json:async()=>({status:'completed',processed:1})});
  vi.stubGlobal('fetch',request);
  const batchId = 'a7017b53-8a7f-4fa2-b15f-c32b50953f12';
  render(<BatchRunner batchId={batchId} active/>);
  await act(()=>vi.advanceTimersByTimeAsync(1));
  fireEvent.click(screen.getByText('Resume processing'));
  await act(()=>vi.advanceTimersByTimeAsync(2000));
  expect(router.refresh).toHaveBeenCalledTimes(2);
  expect(request).toHaveBeenCalledTimes(3);
  expect(request.mock.calls[0]).toEqual(['/api/admin/ingestion/process-chunk',expect.objectContaining({
    method:'POST',body:JSON.stringify({batchId}),
  })]);
  await act(()=>vi.advanceTimersByTimeAsync(60000));
  expect(request).toHaveBeenCalledTimes(3);
});
