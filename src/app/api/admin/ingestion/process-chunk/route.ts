import { z } from 'zod';
import { getDbPool } from '@/lib/db';
import { AdminAuthError, requireAdminUser } from '@/modules/admin/auth';
import { processNextIngestionChunk } from '@/modules/ingestion/chunk-worker';
import { createIngestionWorkerDeps } from '@/modules/ingestion/production';

export const runtime = 'nodejs';
export const maxDuration = 60;

const Chunk = z.object({ batchId: z.string().uuid(), chunkSize: z.number().int().min(1).max(3).default(3) }).strict();
const headers = { 'Cache-Control': 'private, no-store' };

export async function POST(request: Request) {
  try {
    const db = getDbPool();
    await requireAdminUser(db);
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return Response.json({code:'INVALID_INPUT', message:'Expected a JSON request.'}, {status:415, headers});
    }
    const input = Chunk.safeParse(await request.json().catch(() => null));
    if (!input.success) {
      return Response.json({code:'INVALID_INPUT', message:'Choose a batch and a chunk size from 1 to 3.'}, {status:400, headers});
    }
    const { batchId, chunkSize } = input.data;
    const progress = await processNextIngestionChunk(createIngestionWorkerDeps(db), batchId, chunkSize);
    return Response.json(progress, {headers});
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return Response.json({ code:error.status === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN', message:error.message }, {status:error.status, headers});
    }
    return Response.json({code:'BATCH_UNAVAILABLE',message:'Could not process this batch. Check its maker and try again.'}, {status:503, headers});
  }
}
