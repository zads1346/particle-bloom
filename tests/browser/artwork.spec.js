import { test, expect } from '@playwright/test';

test('renders without camera access and supports repeated gather/scatter', async ({page}) => {
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{window.cameraRequests=0;Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:()=>{window.cameraRequests++;return Promise.reject(new DOMException('Test denied','NotAllowedError'))}})});
 await page.goto('/');await page.waitForFunction(()=>window.__bloom?.ready);
 expect(await page.evaluate(()=>window.cameraRequests)).toBe(0);
 for(let i=0;i<2;i++){
  await page.getByRole('button',{name:'星散',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__bloom.getState().gather)).toBeLessThan(.1);
  await page.getByRole('button',{name:'绽放',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__bloom.getState().gather)).toBeGreaterThan(.9);
 }
 await page.getByRole('button',{name:/开启手势交互/}).click();
 await expect(page.getByRole('status')).toContainText('权限');
 await expect(page.getByRole('button',{name:/开启手势交互/})).toBeVisible();
 expect(await page.evaluate(()=>window.cameraRequests)).toBe(1);
 expect(errors).toEqual([]);
 await page.screenshot({path:`test-results/${test.info().project.name}-bloom.png`});
});

test('settings, quality, reset and keyboard controls remain usable',async({page})=>{
 await page.goto('/');await page.waitForFunction(()=>window.__bloom?.ready);
 await page.getByRole('button',{name:'打开画质设置'}).click();
 await page.locator('#quality').selectOption('low');
 await expect.poll(()=>page.evaluate(()=>window.__bloom.count)).toBe(28000);
 await page.locator('#cube').uncheck();await page.locator('#cube').check();
 await page.keyboard.press('Escape');await expect(page.locator('#settings')).toBeHidden();
 await page.locator('#scene').click({position:{x:10,y:10}});await page.keyboard.press('Space');
 await expect.poll(()=>page.evaluate(()=>window.__bloom.getState().targetGather)).toBe(0);
 await page.keyboard.press('r');await expect.poll(()=>page.evaluate(()=>window.__bloom.getState().targetGather)).toBe(1);
 const metrics=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));expect(metrics.scroll).toBeLessThanOrEqual(metrics.width);
});
