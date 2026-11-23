import { describe, expect, it } from 'vitest';
import { parseSeamLensCsv, parseShopifyProductsJson } from '@/modules/ingestion/parsers';

describe('approved source import normalization', () => {
  it('groups Shopify sibling editions and keeps distinct product links and prices', () => {
    const result = parseShopifyProductsJson({products:[
      {id:1,title:'Solène Dress (Sizes 0–20)',handle:'solene-straight', variants:[{price:'12.99'}], images:[{src:'https://cdn.example/cover.jpg'}]},
      {id:2,title:'Solène Dress - Curve 14–34',handle:'solene-curve',variants:[{price:'13.00'}]},
      {id:3,title:'Curve Collar Top',handle:'curve-collar'},
    ]}, 'https://example.com');
    expect(result.map(r => r.title)).toEqual(['Solène Dress','Curve Collar Top']);
    expect(result[0].sizeBands).toMatchObject([
      { externalProductId:'1',priceCents:1299,isDefault:true,productUrl:'https://example.com/products/solene-straight' },
      { externalProductId:'2',priceCents:1300,isDefault:false,productUrl:'https://example.com/products/solene-curve' },
    ]);
  });

  it('keeps the edition and parenthesized size range together', () => {
    const products = ['Straight (Sizes 0–20)', 'Curve (Sizes 14–32)'].map((edition, i) => ({
      id: i + 1, title: 'Elm Dress - ' + edition, handle: 'elm-' + i,
    }));
    const drafts = parseShopifyProductsJson({ products }, 'https://example.com');
    expect(drafts.map(draft => draft.title)).toEqual(['Elm Dress']);
    expect(drafts[0].sizeBands.map(band => band.bandLabel)).toEqual(['Straight (Sizes 0–20)', 'Curve (Sizes 14–32)']);
  });

  it('preserves quoted text and groups repeated CSV bands and images by view', () => {
    const drafts = parseSeamLensCsv('\uFEFFtitle,band_label,product_url,bust_min_cm,bust_max_in,hip_max_cm,view_code,view_label,flat_front_image_url,formats,description_html\r\nAda,Curve,https://example.com/ada,84,"33½""",137,A,View A,https://cdn.example/a.png,pdf_a0,"one, two\r\n""three"""\r\nAda,Curve,https://example.com/ada,84,"33½""",137,B,View B,https://cdn.example/b.png,pdf_a0,');
    expect(drafts).toHaveLength(1);
    expect(drafts[0].sizeBands).toHaveLength(1);
    expect(drafts[0].sizeBands[0]).toMatchObject({externalProductId:null,bustMinIn:33.1,bustMaxIn:33.5,hipMaxIn:53.9,hipMinIn:null});
    expect(drafts[0].descriptionHtml).toBe('one, two\r\n"three"');
    expect(drafts[0].imageUrls.map(image => image.viewCode)).toEqual(['A','B']);
    expect(drafts[0].explicitViews).toHaveLength(2);
    expect(() => parseSeamLensCsv('title,product_url\n"open')).toThrow();
  });
});
