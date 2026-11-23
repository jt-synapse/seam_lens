// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ActionForm from '@/app/admin/ActionForm';
import { BandFields } from '@/app/admin/patterns/[id]/BandFields';
import { ProfileFields } from '@/app/admin/patterns/[id]/ProfileFields';
import { readCuration } from '@/app/admin/patterns/fields';
import type { ConstructionProfileV1 } from '@/modules/taxonomy/construction-profile';
import type { EditableBand } from '@/modules/admin/cockpit-repo';

afterEach(cleanup);
const profile: ConstructionProfileV1 = {
  schema_version:1,garment_category:'dress',substrate_compatibility:'woven',
  silhouette:{overall_shape:'a_line',ease_level:'relaxed',garment_length:'midi'},
  bodice_and_neckline:{neckline_type:'square',neckline_depth:'modest_mid',collar_type:'none',
    shaping_darts_seams:['bust_dart','waist_dart'],waist_definition:'natural_seam',back_detail:'tie_back'},
  sleeves_and_armscye:{armscye_construction:'set_in',sleeve_style:'fitted_straight',sleeve_length:'elbow',cuff_finish:'band_cuff'},
  skirt_and_hemline:{has_skirt_section:true,skirt_construction:'a_line_panel',tier_count:0,slit_detail:'side_slit',
    hemline_shape:'straight_level',pockets:['in_seam']},
  closures_and_details:{primary_closure:'invisible_zip_side',finish_structure:'lined_bodice'},
  structural_nuance_notes:{bodice_neckline:'Raised bust darts',sleeves_armscye:'',skirt_hemline:'',overall_drape_and_proportions:''},
};
const band: EditableBand = {bandLabel:'Standard',isDefault:true,productUrl:'https://maker.example/dress',
  currency:'GBP',priceCents:null,designerSizeLabel:null,externalProductId:'maker-band',bustMinIn:32,bustMaxIn:44,
  hipMinIn:null,hipMaxIn:null};

it('round-trips every taxonomy group, permits category corrections and preserves missing measurements', () => {
  const {container} = render(<form>
    <input type="hidden" name="viewId" value="2a4426cf-0990-47c3-a01c-3d1953e1c68d"/>
    <input type="hidden" name="revision" value="2026-11-22T12:34:56.123456Z"/>
    <input type="hidden" name="substrateType" value="woven"/><input type="hidden" name="skillLevel" value="intermediate"/>
    <input type="hidden" name="formats" value="projector"/>
    <ProfileFields profile={profile}/><BandFields bands={[band]}/>
  </form>);
  const form = container.querySelector('form')!;
  const initial = readCuration(new FormData(form));
  expect(initial.constructionProfile).toEqual(profile);
  expect(initial.sizeBands[0]).toMatchObject(band);
  fireEvent.change(screen.getByLabelText('Garment category'),{target:{value:'top'}});
  expect(form.checkValidity()).toBe(true);
  expect(readCuration(new FormData(form)).constructionProfile.garment_category).toBe('top');
  fireEvent.click(screen.getByText('Add size band'));
  expect(screen.getAllByLabelText('Product URL')).toHaveLength(2);
  fireEvent.click(screen.getByText('Remove new band'));
  expect(readCuration(new FormData(form)).sizeBands).toHaveLength(1);
});

it('passes the clicked status button and preserves typed edits when the action rejects a change', async () => {
  const save = vi.fn(async (_data:FormData)=>({error:'Review before publishing.'}));
  render(<ActionForm action={save}><label>Title<input name="title" defaultValue="Draft"/></label>
    <button name="status" value="published">Publish</button><button name="status" value="takedown">Takedown</button></ActionForm>);
  fireEvent.change(screen.getByLabelText('Title'),{target:{value:'Edited draft'}});
  fireEvent.click(screen.getByText('Takedown'));
  expect((await screen.findByRole('alert')).textContent).toBe('Review before publishing.');
  expect(save.mock.calls[0][0].get('status')).toBe('takedown');
  expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Edited draft');
});
