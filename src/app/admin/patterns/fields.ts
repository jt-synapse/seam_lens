import * as t from '@/modules/taxonomy/construction-profile';
import { z } from 'zod';

type Field = { key: string; options?: readonly (string | number)[]; kind?: 'many' | 'boolean' | 'number' | 'note' };
export type FieldGroup = { section: string; title: string; fields: Field[] };

export const groups: FieldGroup[] = [
  {section: '', title: 'Garment', fields: [
    {key:'garment_category',options:t.GARMENT_CATEGORIES},
    {key:'substrate_compatibility',options:t.SUBSTRATE_COMPATIBILITIES},
  ]},
  {section:'silhouette',title:'Silhouette',fields:[
    {key:'overall_shape',options:t.OVERALL_SHAPES},{key:'ease_level',options:t.EASE_LEVELS},
    {key:'garment_length',options:t.GARMENT_LENGTHS},
  ]},
  {section:'bodice_and_neckline',title:'Bodice and neckline',fields:[
    {key:'neckline_type',options:t.NECKLINE_TYPES},{key:'neckline_depth',options:t.NECKLINE_DEPTHS},
    {key:'collar_type',options:t.COLLAR_TYPES},{key:'shaping_darts_seams',kind:'many',options:t.SHAPING_DARTS_SEAMS},
    {key:'waist_definition',options:t.WAIST_DEFINITIONS},{key:'back_detail',options:t.BACK_DETAILS},
  ]},
  {section:'sleeves_and_armscye',title:'Sleeves and armscye',fields:[
    {key:'armscye_construction',options:t.ARMSCYE_CONSTRUCTIONS},{key:'sleeve_style',options:t.SLEEVE_STYLES},
    {key:'sleeve_length',options:t.SLEEVE_LENGTHS},{key:'cuff_finish',options:t.CUFF_FINISHES},
  ]},
  {section:'skirt_and_hemline',title:'Skirt and hemline',fields:[
    {key:'has_skirt_section',kind:'boolean'},{key:'skirt_construction',options:t.SKIRT_CONSTRUCTIONS},
    {key:'tier_count',kind:'number',options:t.TIER_COUNTS},{key:'slit_detail',options:t.SLIT_DETAILS},
    {key:'hemline_shape',options:t.HEMLINE_SHAPES},{key:'pockets',kind:'many',options:t.POCKET_TYPES},
  ]},
  {section:'closures_and_details',title:'Closures and details',fields:[
    {key:'primary_closure',options:t.PRIMARY_CLOSURES},{key:'finish_structure',options:t.FINISH_STRUCTURES},
  ]},
  {section:'structural_nuance_notes',title:'Construction notes',fields:[
    {key:'bodice_neckline',kind:'note'},{key:'sleeves_armscye',kind:'note'},
    {key:'skirt_hemline',kind:'note'},{key:'overall_drape_and_proportions',kind:'note'},
  ]},
];

export function label(value: string) {
  const labels: Record<string, string> = {
    pdf_a4_letter: 'PDF · A4 / US Letter', pdf_a0: 'Copyshop A0', paper_envelope: 'Paper envelope',
    shaping_darts_seams:'Shaping, darts and seams', substrate_compatibility: 'View substrate compatibility',
  };
  return labels[value] ?? (value.charAt(0).toUpperCase() + value.slice(1).replaceAll('_', ' '));
}

export function readCuration(form: FormData) {
  const profile: Record<string,unknown> = {schema_version:1};
  for (const group of groups) {
    const section: Record<string,unknown> = group.section ? {} : profile;
    if (group.section) profile[group.section] = section;
    for (const field of group.fields) {
      const name = group.section + '.' + field.key;
      const value = form.get(name);
      section[field.key] = field.kind === 'many' ? form.getAll(name)
        : field.kind === 'boolean' ? value === 'on'
        : field.kind === 'number' && value !== null && value !== '' ? Number(value) : value;
    }
  }
  const sizeBands = form.getAll('bandKey').map(key => {
    const value = (field: string) => String(form.get('band.' + key + '.' + field) ?? '').trim();
    const number = (field: string) => value(field) === '' ? null : Number(value(field));
    return {
      id:value('id') || undefined, externalProductId:value('externalProductId') || null,
      bandLabel:value('bandLabel'), isDefault:form.get('defaultBand') === key,
      productUrl:value('productUrl'), priceCents:number('priceCents'), currency:value('currency'),
      designerSizeLabel:value('designerSizeLabel') || null,
      bustMinIn:z.number().parse(number('bustMinIn')), bustMaxIn:z.number().parse(number('bustMaxIn')),
      hipMinIn:number('hipMinIn'), hipMaxIn:number('hipMaxIn'),
    };
  });
  return {
    viewId:z.string().uuid().parse(form.get('viewId')), expectedUpdatedAt:z.string().min(1).parse(form.get('revision')),
    constructionProfile:t.ConstructionProfileV1Schema.parse(profile), sizeBands,
    substrateType:t.SubstrateCompatibilitySchema.parse(form.get('substrateType')),
    formats:t.DeliveryFormatSchema.array().parse(form.getAll('formats')), skillLevel:t.SkillLevelSchema.parse(form.get('skillLevel')),
  };
}
