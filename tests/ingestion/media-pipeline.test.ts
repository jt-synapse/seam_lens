import sharp from 'sharp';
import { expect, it, vi } from 'vitest';
import { createGalleryPreparer } from '@/modules/ingestion/media-pipeline';
import type { NormalizedImportDraft } from '@/modules/ingestion/parsers';

it('groups classified views, honors explicit flats and only writes immutable selected WebPs', async () => {
  const sample = await sharp({create:{width:2000,height:900,channels:3,background:'white'}})
    .withMetadata().png().toBuffer();
  const fetchImage = vi.fn(async (_url: string) => sample);
  const store = new Map<string,Buffer>();
  const write = vi.fn(async (key: string, bytes:Buffer) => {store.set(key,bytes); return 'media/'+key;});
  const classify = vi.fn(async () => [
    {index:0,viewCode:'A',viewLabel:'View A',role:'cover' as const},
    {index:1,viewCode:'A',viewLabel:'View A',role:'flat_front' as const},
    {index:2,viewCode:'B',viewLabel:'View B',role:'flat_back' as const},
    {index:3,viewCode:'',viewLabel:'',role:'ignore' as const},
  ]);
  const draft:NormalizedImportDraft = {
    groupKey:'ada',title:'Ada',formatsHint:[],sizeBands:[],descriptionHtml:'View A and View B.',
    explicitViews:[{viewCode:'A',viewLabel:'First view'}],
    imageUrls:[
      {url:'https://example.com/front',viewCode:'A',roleHint:'flat_front'},
      ...['cover','other-front','back','ignore'].map(name=>({url:'https://example.com/'+name})),
    ],
  };
  const prepare = createGalleryPreparer({fetchImage,write,classify});
  const input = {draft,makerSlug:'maker',patternSlug:'ada',assertActive:vi.fn(async()=>{})};
  const views = await prepare(input);
  expect(views.map(v=>[v.viewCode,v.viewLabel,v.images.map(i=>i.role).sort()])).toEqual([
    ['A','First view',['cover','flat_front']],['B','View B',['flat_back']],
  ]);
  expect(write).toHaveBeenCalledTimes(6);
  for (const [key,data] of store) {
    const metadata = await sharp(data).metadata();
    expect(metadata.format).toBe('webp');
    expect(metadata.width).toBe(key.endsWith('-card.webp') ? 800 : 1600);
    expect(metadata.exif).toBeUndefined();
  }
  const keys = [...store.keys()];
  await prepare(input);
  expect([...store.keys()]).toEqual(keys);
  expect(classify).toHaveBeenCalledTimes(2);
  await prepare({...input,draft:{...draft,imageUrls:[draft.imageUrls[0]]}});
  expect(classify).toHaveBeenCalledTimes(2);
});
