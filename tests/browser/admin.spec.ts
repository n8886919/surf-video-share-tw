import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function fixture(page: Page, role: "anonymous" | "member" | "admin") {
  let resolved=false; const calls: string[]=[]; const writes: unknown[]=[];
  await page.route('**/api/v1/**',async route=>{
    const url=new URL(route.request().url());const path=url.pathname;calls.push(path);
    let body: unknown={}; let status=200;
    if(path.endsWith('/auth/line/complete')) body={status:'none'};
    else if(path.endsWith('/me')) {if(role==='anonymous'){status=401;body={error:'UNAUTHENTICATED'};}else body={id:'test-user',isAdmin:role==='admin',authMode:'line'};}
    else if(path.endsWith('/spots')) body={spots:[]};
    else if(path.endsWith('/videos')) body={observations:[]};
    else if(path.endsWith('/thumbnail')) {await route.fulfill({status:404});return;}
    else if(path.endsWith('/playback')) body={type:'mock',iframeUrl:null};
    else if(path.endsWith('/reports/report-1/resolve')) {resolved=true;writes.push(route.request().postDataJSON());body={status:'resolved'};}
    else if(path.endsWith('/admin/reports')) body={reports:(resolved=== (url.searchParams.get('status')==='resolved')) ? [{
      id:'report-1',videoId:'video-1',reason:'minor',status:resolved?'resolved':'open',createdAt:'2026-09-08T00:00:00Z',
      capturedAt:'2026-09-07T00:00:00Z',spotName:'雙獅',durationSeconds:20,moderationStatus:'visible',uploaderNote:'測試實拍',
      resolutionAction:resolved?'resolve':null,resolutionReason:resolved?'test':null,resolvedAt:resolved?'2026-09-08T01:00:00Z':null,
    }] : []};
    else if(path.endsWith('/problem-reports')) body={reports:[]};
    else if(path.endsWith('/history')) body={actions:[]};
    else if(path.endsWith('/diagnostics')) body={days:[]};
    else {status=404;body={error:'NOT_FOUND'};}
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  });
  return {calls,writes};
}
test('admin page asks for LINE login and never requests administrative data for anonymous or regular members',async({page})=>{
  const anonymous=await fixture(page,'anonymous');await page.goto('/admin');
  await expect(page.getByRole('link',{name:'使用 LINE 登入',exact:true})).toBeVisible();
  expect(anonymous.calls.some(path=>path.includes('/admin/'))).toBe(false);
  await page.unroute('**/api/v1/**');const member=await fixture(page,'member');await page.reload();
  await expect(page.getByRole('heading',{name:'無權存取管理後台'})).toBeVisible();
  expect(member.calls.some(path=>path.includes('/admin/'))).toBe(false);
});
test('administrator previews reported video and resolves test report without delisting; history is separate from My',async({page})=>{
  const result=await fixture(page,'admin');await page.goto('/admin');
  await expect(page.getByRole('heading',{name:'全站影片檢舉'})).toBeVisible();
  expect(result.calls).not.toContain('/api/v1/videos');expect(result.calls).not.toContain('/api/v1/spots');
  await page.getByRole('button',{name:'播放影片',exact:true}).click();
  await expect(page.getByText('測試影片預覽')).toBeVisible();
  await page.getByLabel('保留影片的原因').selectOption('test');
  await page.getByRole('button',{name:'保留影片並結案'}).click();
  await expect(page.getByText('目前沒有待處理影片檢舉。')).toBeVisible();
  expect(result.writes).toEqual([{reason:'test'}]);expect(result.calls.some(path=>path.endsWith('/delist'))).toBe(false);
  await page.getByRole('button',{name:'已處理',exact:true}).click();
  await expect(page.getByText(/保留並結案／測試/)).toBeVisible();
  const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();
  expect(axe.violations).toEqual([]);
  await page.screenshot({path:'outputs/admin-029.png',fullPage:true});
});
test('original browser returns to the fixed admin page after verified LINE completion without trusting the navigation flag for access',async({page})=>{
  const result=await fixture(page,'member');
  await page.addInitScript(()=>sessionStorage.setItem('surf-admin-return','1'));
  await page.goto('/?login=completing');
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading',{name:'無權存取管理後台'})).toBeVisible();
  expect(result.calls.some(path=>path.includes('/admin/'))).toBe(false);
});
