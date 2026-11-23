'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getDbPool, type Queryable } from '@/lib/db';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireAdminUser } from '@/modules/admin/auth';
import { saveMaker } from '@/modules/admin/cockpit-repo';
import { mergeSizeBandIntoPattern, savePatternViewCuration, setPatternPublishStatus } from '@/modules/admin/curation-actions';
import { enqueueIngestionBatch, retryIngestionItem } from '@/modules/ingestion/chunk-worker';
import { parseSeamLensCsv } from '@/modules/ingestion/parsers';
import { fetchApprovedShopifyDrafts } from '@/modules/ingestion/production';
import { createGeminiTextEmbedder } from '@/modules/vision/gemini-text-embedder';
import { readCuration } from './patterns/fields';
import { interruptDeniedAccess, requireAtelierAdmin } from './access';

export type Feedback = { error?: string; message?: string };
type Admin = Awaited<ReturnType<typeof requireAdminUser>>;

async function change(run: (db: Queryable, admin: Admin) => Promise<string>, destination?: string): Promise<Feedback> {
  const db = getDbPool();
  const admin = await requireAtelierAdmin(db);
  let message: string;
  try {
    message = await run(db, admin);
  } catch (error) {
    interruptDeniedAccess(error);
    if (error instanceof z.ZodError) {
      const issue = error.issues[0];
      return {error: [issue.path.join(' '), issue.message].filter(Boolean).join(' · ')};
    }
    if (error instanceof Error && 'code' in error && typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)) {
      return {error: error.code === '23505' ? 'This identifier or band label is already in use.' :
        error.code === 'P0001' ? error.message : 'The database could not save this change. Check the fields and try again.'};
    }
    return {error: error instanceof Error ? error.message : 'The change could not be saved.'};
  }
  revalidatePath('/admin', 'layout');
  if (destination) redirect(destination);
  return {message};
}

export async function loginAction(form: FormData): Promise<Feedback> {
  const client = await createSupabaseServerClient();
  const {error} = await client.auth.signInWithPassword({
    email:String(form.get('email') ?? '').trim(), password:String(form.get('password') ?? ''),
  });
  if (error) return {error:'Check your email and password and try again.'};
  try {
    await requireAdminUser(getDbPool());
  } catch {
    await client.auth.signOut({scope:'local'});
    return {error:'This account could not access the curator workspace.'};
  }
  redirect('/admin/patterns');
}

export async function makerAction(form: FormData) {
  return change(async db => {
    await saveMaker(db,form);
    return 'Maker details saved.';
  });
}

export async function importAction(form: FormData) {
  let batchId: string | undefined;
  const result = await change(async (db,admin) => {
    const makerId = z.string().uuid().parse(form.get('makerId'));
    const sourceType = z.enum(['csv_upload','shopify_json']).parse(form.get('sourceType'));
    const file = form.get('csv');
    let drafts;
    let sourceDescriptor;
    if (sourceType === 'csv_upload') {
      if (!file || typeof file === 'string' || !file.size) throw new Error('Choose a CSV file.');
      if (file.size > 900_000) throw new Error('Split CSV files larger than 900 KB into smaller batches.');
      drafts = parseSeamLensCsv(await file.text());
      sourceDescriptor = file.name;
    } else {
      sourceDescriptor = String(form.get('source') || '').trim();
      drafts = await fetchApprovedShopifyDrafts(db,makerId,sourceDescriptor);
      sourceDescriptor ||= 'Storefront products';
    }
    const batch = await enqueueIngestionBatch(db,{makerId,sourceType,sourceDescriptor,drafts,createdBy:admin.userId});
    batchId = batch.batchId;
    return 'Import queued.';
  });
  if (batchId) redirect('/admin/imports?batch=' + batchId);
  return result;
}

export async function retryAction(form: FormData) {
  return change(async db => {
    await retryIngestionItem(db,z.string().uuid().parse(form.get('itemId')));
    return 'Item queued for another attempt.';
  });
}

export async function curationAction(form: FormData) {
  return change(async db => {
    const input = readCuration(form);
    await savePatternViewCuration({db,embedder:createGeminiTextEmbedder(db)},input);
    return 'View verified. Construction tags, size bands and search embeddings are saved.';
  });
}

export async function publishAction(form: FormData) {
  return change(async db => {
    const status = z.enum(['published','unpublished','takedown']).parse(form.get('status'));
    await setPatternPublishStatus(db,z.string().uuid().parse(form.get('patternId')),status);
    return 'Catalog status updated.';
  });
}

export async function mergeAction(form: FormData) {
  return change(async db => {
    await mergeSizeBandIntoPattern(db,z.string().uuid().parse(form.get('patternId')),
      z.string().uuid().parse(form.get('targetId')),z.string().trim().min(1).parse(form.get('bandLabel')));
    return 'Size band merged.';
  }, '/admin/patterns?merged=1');
}

export async function logoutAction(): Promise<Feedback> {
  await requireAtelierAdmin(getDbPool());
  const client = await createSupabaseServerClient();
  const {error} = await client.auth.signOut({scope:'local'});
  if (error) return {error:'Sign out failed. Try again.'};
  redirect('/admin/login');
}
