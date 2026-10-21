import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
const fixtures = join(tmpdir(), 'studio-browser-fixtures');
test.beforeAll(() => {
  mkdirSync(fixtures, { recursive: true });
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=640x360:rate=24',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=48000',
    '-t',
    '4',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    join(fixtures, 'source.mp4'),
  ]);
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=magenta:size=320x568:rate=24',
    '-t',
    '1',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    join(fixtures, 'reference.mp4'),
  ]);
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=220:sample_rate=48000',
    '-t',
    '3',
    join(fixtures, 'music.wav'),
  ]);
});
async function ready(page: any) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Approve & render', exact: true })).toBeVisible({
    timeout: 60000,
  });
}
async function localProject(page: any) {
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Reference reel', { exact: true })
    .setInputFiles(join(fixtures, 'reference.mp4'));
  await expect(dialog.getByLabel('Reference reel preview', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create storyboard', exact: true })).toBeDisabled();
  await dialog
    .getByLabel('Reference style notes', { exact: true })
    .fill('Quick pacing, bold captions, a question hook.');
  await dialog.getByRole('button', { name: /AA Bold/ }).click();
  await expect(dialog.getByRole('button', { name: 'Remove reference', exact: true })).toBeVisible();
  await dialog
    .getByLabel('Raw footage', { exact: true })
    .setInputFiles(join(fixtures, 'source.mp4'));
  await page.getByLabel('Project name', { exact: true }).fill('My local reel');
  await page
    .getByLabel('Caption script', { exact: true })
    .fill('Hello from this browser!\nA real captioned export.');
  await dialog
    .getByLabel('Background music', { exact: true })
    .setInputFiles(join(fixtures, 'music.wav'));
  await page.getByRole('button', { name: 'Create storyboard', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My local reel', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve & render', exact: true })).toBeVisible({
    timeout: 60000,
  });
}
test('local upload → real GIF → explicit approval → caption/audio MP4 → reviewed ZIP', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const uploads: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST') uploads.push(r.url());
  });
  await ready(page);
  await localProject(page);
  await page.getByText('Project inputs · 1 style reference · 1 raw clip', { exact: true }).click();
  await expect(page.getByLabel('Reference style input', { exact: true })).toContainText(
    'reference.mp4',
  );
  await expect(page.getByLabel('Reference style input', { exact: true })).toContainText(
    'Quick pacing, bold captions, a question hook.',
  );
  await expect(page.getByLabel('Raw footage input', { exact: true })).toContainText('source.mp4');
  const inputs = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('reel-studio-local-v1');
      r.onsuccess = () => resolve(r.result);
    });
    const projects: any[] = await new Promise((resolve) => {
      const r = db.transaction('projects').objectStore('projects').getAll();
      r.onsuccess = () => resolve(r.result);
    });
    const p = projects.find((p) => p.name === 'My local reel');
    return {
      reference: p.reference.id,
      raw: p.sources.A.id,
      sources: Object.keys(p.sources),
      transcripts: Object.keys(p.transcripts),
      cuts: p.reels[0].segments,
    };
  });
  expect(inputs.reference).toMatch(/^sample-/);
  expect(inputs.raw).toMatch(/^source-/);
  expect(inputs.reference).not.toBe(inputs.raw);
  expect(inputs.sources).toEqual(['A']);
  expect(inputs.transcripts).toEqual(['A']);
  expect(inputs.cuts).toEqual([{ src: 'A', s: 0, e: 4 }]);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Approve & render', exact: true })).toBeEnabled();
  await page.getByText('Project inputs · 1 style reference · 1 raw clip', { exact: true }).click();
  const reference = page.getByLabel('Style reference video', { exact: true });
  await reference.evaluate((v: HTMLVideoElement) => v.load());
  await expect
    .poll(() => reference.evaluate((v: HTMLVideoElement) => [v.videoWidth, v.videoHeight]))
    .toEqual([320, 568]);
  await page.getByLabel('Opening hook', { exact: true }).fill('Made on this device');
  await page.getByRole('tab', { name: 'Framing', exact: true }).click();
  await page.getByLabel('Segment 1 start', { exact: true }).fill('0.5');
  await page.getByLabel('Segment 1 end', { exact: true }).fill('1.5');
  await page.getByLabel('Zoom', { exact: true }).fill('1.2');
  await page.getByLabel('Punch-ins', { exact: true }).fill('0.4');
  await page.getByText('Add from the transcript', { exact: false }).click();
  await page.locator('.sentence-pick').nth(1).click();
  await page.getByRole('tab', { name: 'Audio', exact: true }).click();
  await page.getByRole('switch', { name: 'Sound effects enabled', exact: true }).check();
  await expect(page.getByRole('button', { name: 'Approve & render', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Update storyboard', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve & render', exact: true })).toBeEnabled({
    timeout: 60000,
  });
  await page.getByRole('button', { name: 'Approve & render', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Accept passing renders', exact: true }),
  ).toBeVisible({ timeout: 120000 });
  const video = page.getByRole('region', { name: 'Video preview', exact: true }).locator('video');
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => [v.videoWidth, v.videoHeight]))
    .toEqual([540, 960]);
  await page.getByRole('button', { name: 'Accept passing renders', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export reels', exact: true }).click();
  const file = await download;
  const path = testInfo.outputPath('reels.zip');
  await file.saveAs(path);
  const zip = unzipSync(readFileSync(path));
  expect(Object.keys(zip)).toEqual(['r01.mp4']);
  const mp4 = testInfo.outputPath('r01.mp4');
  writeFileSync(mp4, zip['r01.mp4']);
  const info = JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', mp4], {
      encoding: 'utf8',
    }),
  );
  expect(
    info.streams.some((s: any) => s.codec_type === 'audio' && s.codec_name === 'aac'),
  ).toBeTruthy();
  expect(Number(info.format.duration)).toBeCloseTo(3, 1);
  const pixels = execFileSync('ffmpeg', [
    '-v',
    'error',
    '-i',
    mp4,
    '-frames:v',
    '1',
    '-vf',
    'crop=540:60:0:0,scale=32:4',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    'pipe:1',
  ]);
  // The reference is solid magenta. Raw footage has a coloured test pattern.
  expect(
    Array.from(pixels)
      .filter((_, i) => i % 3 === 1)
      .some((g) => g > 100),
  ).toBeTruthy();
  expect(uploads).toEqual([]);
  expect(errors).toEqual([]);
});
test('drafts/stale tabs and tampered storyboard artifacts cannot release a render', async ({
  page,
  context,
}) => {
  await ready(page);
  await page.getByLabel('Caption colour #60a5fa', { exact: true }).click();
  const other = await context.newPage();
  await ready(other);
  await other.getByLabel('Caption colour #f9a8d4', { exact: true }).click();
  await other.getByRole('button', { name: 'Update storyboard', exact: true }).click();
  await expect(page.getByText(/This plan changed while you were editing/)).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole('button', { name: 'Approve & render', exact: true })).toBeDisabled();
  await other.close();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Approve & render', exact: true })).toBeEnabled({
    timeout: 60000,
  });
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('reel-studio-local-v1');
      r.onsuccess = () => resolve(r.result);
    });
    const p: any = await new Promise((resolve) => {
      const r = db.transaction('projects').objectStore('projects').get('browser-sample');
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction('media', 'readwrite');
      tx.objectStore('media').put(new Blob(['tampered']), p.reels[0].gif.url.slice(6));
      tx.oncomplete = () => resolve();
    });
  });
  let engineRequests = 0;
  page.on('request', (r) => {
    if (r.url().includes('/engine/')) engineRequests++;
  });
  await page.getByRole('button', { name: 'Approve & render', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/Approval is stale/);
  expect(engineRequests).toBe(0);
});
test('cancelling the engine keeps the sources and requires fresh approval', async ({ page }) => {
  await ready(page);
  await page.route('**/engine/core-0.part', async (route) => {
    await new Promise((r) => setTimeout(r, 2000));
    await route.continue().catch(() => {});
  });
  await page.getByRole('button', { name: 'Approve & render', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Stop worker', exact: true }).first(),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Stop worker', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Resume project', exact: true })).toBeVisible({
    timeout: 20000,
  });
  await page.getByRole('button', { name: 'Resume project', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve & render', exact: true })).toBeEnabled({
    timeout: 60000,
  });
});
test('mobile layout and reload recovery preserve local files without silently rendering', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.route('**/engine/core-0.part', async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    await route.continue().catch(() => {});
  });
  await page.getByRole('button', { name: 'Approve & render', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Stop worker', exact: true }).first(),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Processing stopped when this tab closed/)).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole('link', { name: 'Export reels', exact: true })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
});

test('the same file can be explicitly uploaded into both roles without overwriting either', async ({
  page,
}) => {
  await ready(page);
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Reference reel', { exact: true })
    .setInputFiles(join(fixtures, 'source.mp4'));
  await expect(dialog.getByRole('button', { name: 'Remove reference', exact: true })).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Create storyboard', exact: true }),
  ).toBeDisabled();
  await dialog
    .getByLabel('Raw footage', { exact: true })
    .setInputFiles(join(fixtures, 'source.mp4'));
  await dialog.getByLabel('Project name', { exact: true }).fill('Explicit roles');
  await dialog.getByRole('button', { name: 'Create storyboard', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve & render', exact: true })).toBeEnabled({
    timeout: 60000,
  });
  const roles = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('reel-studio-local-v1');
      r.onsuccess = () => resolve(r.result);
    });
    return await new Promise<string[]>((resolve) => {
      const r = db.transaction('assets').objectStore('assets').getAll();
      r.onsuccess = () =>
        resolve(
          r.result
            .filter((a) => a.name === 'source.mp4')
            .map((a) => a.role)
            .sort(),
        );
    });
  });
  expect(roles).toEqual(['sample', 'source']);
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByText('Use a previously uploaded file', { exact: true }).click();
  const ref = dialog.locator('.library-row').filter({ hasText: 'Reference style' });
  await ref.getByRole('button').first().click();
  await expect(dialog.getByRole('button', { name: 'Remove reference', exact: true })).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Create storyboard', exact: true }),
  ).toBeDisabled();
  await ref.getByRole('button', { name: 'Delete stored source.mp4', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('still used by a project');
});
