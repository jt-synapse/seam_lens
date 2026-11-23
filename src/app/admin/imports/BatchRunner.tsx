'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function BatchRunner({batchId,active}: {batchId:string;active:boolean}) {
  const router = useRouter();
  const [error,setError] = useState('');
  const [attempt,setAttempt] = useState(0);
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function process() {
      try {
        const res = await fetch('/api/admin/ingestion/process-chunk',{
          method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({batchId}),signal:controller.signal,
        });
        if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ?
          'Your curator session has ended. Sign in again to continue.' : 'Processing paused. Resume to try this batch again.');
        const result = await res.json();
        if (stopped) return;
        router.refresh();
        if (['queued','processing'].includes(result.status)) timer = setTimeout(process,result.processed === 0 ? 5000 : 700);
      } catch (cause) {
        if (!stopped) setError(cause instanceof Error ? cause.message : 'Processing paused.');
      }
    }
    // Defer to avoid dispatching a duplicate chunk on a development-mode remount.
    timer = setTimeout(process,0);
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  },[batchId,active,attempt,router]);
  if (!active) return null;
  return error ? <p role="alert">{error} <button onClick={() => {setError('');setAttempt(n=>n+1);}}>Resume processing</button></p>
    : <p className="admin-note" role="status">Processing this batch. Keep this page open for the next chunk.</p>;
}
