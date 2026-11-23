// Browser clocks measure the UI. Database checks and driver round trips stay outside the interval.
import type { Locator, Page } from 'playwright-core';
import type { BenchmarkCase } from '@/modules/eval/metrics';
import type { SearchExecutionResult } from '@/modules/search/hybrid-ranker';

async function measurePaint(page: Page, control: Locator, action: () => Promise<void>,
  kind: 'upload' | 'refine', event: 'click' | 'blur' = 'click') {
  await control.evaluate((element, { kind, event }) => {
    performance.clearMeasures('seamlens-results');
    element.addEventListener(event, () => {
      const start = performance.now();
      const observer = new MutationObserver(changes => {
        const grid = document.querySelector('.discovery-grid[aria-busy="false"]');
        if (!grid) return;
        // For a refinement the previous grid is already present. Wait for this request to finish.
        if (kind === 'refine' && !changes.some(c => c.target === grid &&
          c.attributeName === 'aria-busy' && c.oldValue === 'true')) return;
        observer.disconnect();
        requestAnimationFrame(() => requestAnimationFrame(() =>
          performance.measure('seamlens-results', { start, end: performance.now() })));
      });
      observer.observe(document.body, {subtree:true, childList:true, attributes:true,
        attributeFilter:['aria-busy'], attributeOldValue:true});
    }, {capture:true, once:true});
  }, {kind, event});
  const endpoint = kind === 'upload' ? '/api/v1/search/analyze' : '/api/v1/search/query';
  const [response] = await Promise.all([
    page.waitForResponse(r => new URL(r.url()).pathname === endpoint && r.request().method() === 'POST'),
    action(),
  ]);
  if (!response.ok()) throw new Error(endpoint + ' returned HTTP ' + response.status());
  const result: SearchExecutionResult = await response.json();
  const duration = await page.waitForFunction(() => performance.getEntriesByName('seamlens-results')[0]?.duration);
  const browserMs = await duration.jsonValue();
  const visible = await page.locator('.discovery-grid a[href^="/go/"]').evaluateAll(links =>
    links.map(link => new URL((link as HTMLAnchorElement).href).pathname.slice('/go/'.length)));
  if (new URL(page.url()).searchParams.get('q') !== result.querySessionId ||
      JSON.stringify(visible) !== JSON.stringify(result.results.map(r => r.patternId))) {
    throw new Error('Painted results differ from the returned session or ranking');
  }
  return { browserMs, rankedPatternIds:visible, sessionId:result.querySessionId,
    request:kind === 'refine' ? response.request().postDataJSON() : null };
}

export async function uploadInBrowser(page: Page, origin: string, image: string, focus: BenchmarkCase['focusRegion']) {
  await page.goto(origin);
  if (new URL(page.url()).origin !== origin) throw new Error('Staging landing page redirected to a different origin');
  await page.getByLabel('Choose reference photo').setInputFiles(image);
  await page.getByLabel('Part focus', {exact:true}).selectOption(focus);
  const submit = page.getByRole('button', {name:'Find patterns', exact:true});
  return measurePaint(page, submit, () => submit.click(), 'upload');
}

// Toggle twice for a repeatable measurement, then leave the UI in the case's labeled filter state.
export async function refineInBrowser(page: Page, filters: BenchmarkCase['filters'] = {}) {
  const measurements: Awaited<ReturnType<typeof measurePaint>>[] = [];
  const clickControl = async (control:Locator) => {
    measurements.push(await measurePaint(page, control, () => control.click(), 'refine'));
  };
  const click = (label:string) => clickControl(page.getByRole('button', {name:label, exact:true}));
  const focus = page.locator('.discovery-focus');
  const original = await focus.locator('button[aria-pressed=true]').innerText();
  await clickControl(focus.locator('button[aria-pressed=false]').first());
  await clickControl(focus.getByRole('button', {name:original,exact:true}));
  await click('Woven');
  await click('Woven');
  if (filters.substrate) await click(filters.substrate === 'woven' ? 'Woven' : 'Knit');
  const labels = {pdf_a4_letter:'PDF A4/Letter', pdf_a0:'Copyshop A0', projector:'Projector',
    paper_envelope:'Paper', confident_beginner:'Confident beginner', intermediate:'Intermediate', advanced_couture:'Advanced / Couture'};
  for (const value of [...filters.formats ?? [], ...filters.skills ?? []]) await click(labels[value]);
  for (const [name, value] of [['My full bust', filters.userBustIn], ['My full hip', filters.userHipIn]] as const) {
    if (value == null) continue;
    const control = page.getByRole('spinbutton', { name:name + ' in inches' });
    await control.fill(String(value));
    measurements.push(await measurePaint(page, control, () => control.press('Enter'), 'refine', 'blur'));
  }
  return measurements;
}
