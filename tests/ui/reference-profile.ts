import type { ConstructionProfileV1 } from '@/modules/taxonomy/construction-profile';

export const referenceProfile: ConstructionProfileV1 = {
      schema_version: 1, garment_category: 'dress', substrate_compatibility: 'woven',
      silhouette: { overall_shape: 'a_line', ease_level: 'relaxed', garment_length: 'midi' },
      bodice_and_neckline: { neckline_type: 'square', neckline_depth: 'modest_mid', collar_type: 'none',
        shaping_darts_seams: ['waist_dart'], waist_definition: 'natural_seam', back_detail: 'unknown' },
      sleeves_and_armscye: { armscye_construction: 'set_in', sleeve_style: 'bishop', sleeve_length: 'elbow', cuff_finish: 'band_cuff' },
      skirt_and_hemline: { has_skirt_section: true, skirt_construction: 'a_line_panel', tier_count: 0, slit_detail: 'none',
        hemline_shape: 'straight_level', pockets: ['none_visible'] },
      closures_and_details: { primary_closure: 'invisible_zip_side', finish_structure: 'fully_lined' },
      structural_nuance_notes: { bodice_neckline: '', sleeves_armscye: '', skirt_hemline: '', overall_drape_and_proportions: '' },
    };
