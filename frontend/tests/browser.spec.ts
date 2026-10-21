import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { checkOfflineInstaller } from './capcut-installer';
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
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=white:size=720x1280:rate=24,drawgrid=w=80:h=48:t=1:c=gray@0.2,drawbox=x=130:y=680:w=460:h=70:c=0x004b06:t=fill,drawtext=fontfile=/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf:text=Reference caption:fontsize=42:fontcolor=white:x=155:y=695',
    '-t',
    '8',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    join(fixtures, 'boxed-reference.mp4'),
  ]);
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=white:size=720x1280:rate=24',
    '-t',
    '4',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    join(fixtures, 'white-raw.mp4'),
  ]);
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    "color=c=0x805030:size=720x1280:rate=24,drawbox=x=0:y=0:w=iw:h=ih:c=0x403020:t=fill:enable='lt(mod(t,1.2),.6)',drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf:text=THIS IS MY CAPTION:fontsize=52:fontcolor=yellow:borderw=3:bordercolor=black:x=(w-tw)/2:y=830",
    '-t',
    '5',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    join(fixtures, 'unboxed-fast-reference.mp4'),
  ]);
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=gray:size=720x1280:rate=24',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=48000',
    '-c:a',
    'aac',
    '-t',
    '4',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    join(fixtures, 'gray-raw.mp4'),
  ]);
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=0x252525:size=720x1280:rate=24,drawgrid=w=72:h=40:t=1:c=gray@0.4,drawbox=x=80:y=200:w=560:h=400:c=0xc2c4bc:t=fill,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text=Small computer interface text:fontsize=20:fontcolor=white:x=180:y=350,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text=CREATE BETTER REELS:fontsize=44:fontcolor=white:borderw=3:bordercolor=black:x=(w-tw)/2:y=825,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text=WITHOUT THE HASSLE:fontsize=44:fontcolor=white:borderw=3:bordercolor=black:x=(w-tw)/2:y=890',
    '-t',
    '5',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    join(fixtures, 'busy-outlined-reference.mp4'),
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
  await dialog.getByRole('button', { name: /AA Bold/ }).click();
  await dialog
    .getByLabel('Reference reel', { exact: true })
    .setInputFiles(join(fixtures, 'boxed-reference.mp4'));
  await expect(dialog.getByLabel('Reference reel preview', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create storyboard', exact: true })).toBeDisabled();
  await dialog
    .getByLabel('Reference style notes', { exact: true })
    .fill('Quick pacing, bold captions, a question hook.');
  await expect(dialog.locator('.preset-grid')).toHaveCount(0);
  await expect(dialog.getByLabel('Use measured caption style', { exact: true })).toHaveCount(0);
  await expect(
    dialog.getByText('Reference caption style detected — applied automatically', { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Remove reference', exact: true })).toBeVisible({
    timeout: 30000,
  });
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
  context,
}, testInfo) => {
  test.setTimeout(120000);
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
    .toEqual([720, 1280]);
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
  expect(Math.min(...pixels)).toBeLessThan(80);
  expect(Math.max(...pixels)).toBeGreaterThan(150);
  await page.getByRole('button', { name: 'Edit in CapCut', exact: true }).click();
  const desktopDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download desktop draft ZIP', exact: true }).click();
  const desktopFile = await desktopDownload,
    desktopPath = testInfo.outputPath('desktop.zip');
  await desktopFile.saveAs(desktopPath);
  const desktop = unzipSync(readFileSync(desktopPath));
  const draft = JSON.parse(new TextDecoder().decode(desktop['r01/draft_content.json']));
  expect(
    draft.tracks
      .find((t: any) => t.type === 'video')
      .segments.map((s: any) => s.source_timerange.start),
  ).toEqual([500000, 2000000]);
  expect(draft.materials.videos[0].duration).toBe(4000000);
  expect(
    Object.keys(desktop)
      .filter((k) => k.startsWith('media/'))
      .sort(),
  ).toEqual(['media/music.wav', 'media/source-A.mp4']);
  expect(Object.keys(desktop).some((k) => /reference\.mp4/.test(k))).toBe(false);
  expect(new TextDecoder().decode(desktop['r01/captions.srt'])).toContain('Made on this device');
  await checkOfflineInstaller(context, desktop);
  const mobileDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Prepare mobile clips ZIP', exact: true }).click();
  const mobileFile = await mobileDownload,
    mobilePath = testInfo.outputPath('mobile.zip');
  await mobileFile.saveAs(mobilePath);
  const mobile = unzipSync(readFileSync(mobilePath));
  expect(
    Object.keys(mobile)
      .filter((k) => k.includes('/clips/'))
      .sort(),
  ).toEqual(['r01/clips/001.mp4', 'r01/clips/002.mp4']);
  for (const [i, name] of ['r01/clips/001.mp4', 'r01/clips/002.mp4'].entries()) {
    const file = testInfo.outputPath('clean-' + i + '.mp4');
    writeFileSync(file, mobile[name]);
    const probe = JSON.parse(
      execFileSync(
        'ffprobe',
        ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file],
        { encoding: 'utf8' },
      ),
    );
    expect(Number(probe.format.duration)).toBeCloseTo(i + 1, 1);
    expect(probe.streams.find((s: any) => s.codec_type === 'video').width).toBe(540);
    expect(probe.streams.some((s: any) => s.codec_type === 'audio')).toBe(true);
  }
  let engineRequests = 0;
  page.on('request', (r) => {
    if (r.url().includes('/engine/')) engineRequests++;
  });
  const cachedDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Prepare mobile clips ZIP', exact: true }).click();
  await (await cachedDownload).saveAs(testInfo.outputPath('mobile-cached.zip'));
  expect(engineRequests).toBe(0);
  const cached = unzipSync(readFileSync(testInfo.outputPath('mobile-cached.zip')));
  expect(Buffer.from(cached['r01/clips/001.mp4'])).toEqual(
    Buffer.from(mobile['r01/clips/001.mp4']),
  );
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
    .setInputFiles(join(fixtures, 'boxed-reference.mp4'));
  await expect(dialog.getByRole('button', { name: 'Remove reference', exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(
    dialog.getByRole('button', { name: 'Create storyboard', exact: true }),
  ).toBeDisabled();
  await dialog
    .getByLabel('Raw footage', { exact: true })
    .setInputFiles(join(fixtures, 'boxed-reference.mp4'));
  await dialog.getByLabel('Project name', { exact: true }).fill('Explicit roles');
  await dialog.getByLabel('Caption script', { exact: true }).fill('Keep the input roles distinct.');
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
            .filter((a) => a.name === 'boxed-reference.mp4')
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
  await expect(dialog.getByRole('button', { name: 'Remove reference', exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(
    dialog.getByRole('button', { name: 'Create storyboard', exact: true }),
  ).toBeDisabled();
  await ref.getByRole('button', { name: 'Delete stored boxed-reference.mp4', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('still used by a project');
});

test('reference caption style comes from 24 frames in five seconds and reaches the real MP4', async ({
  page,
}, testInfo) => {
  await ready(page);
  let engineRequests = 0;
  page.on('request', (r) => {
    if (r.url().includes('/engine/')) engineRequests++;
  });
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page
    .getByLabel('Reference reel', { exact: true })
    .setInputFiles(join(fixtures, 'boxed-reference.mp4'));
  await expect(
    page.getByText('Reference caption style detected — applied automatically', { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.getByLabel('Use measured caption style', { exact: true })).toHaveCount(0);
  await expect(page.locator('.preset-grid')).toHaveCount(0);
  await page
    .getByLabel('Raw footage', { exact: true })
    .setInputFiles(join(fixtures, 'white-raw.mp4'));
  await page.getByLabel('Project name', { exact: true }).fill('Measured caption style');
  await page
    .getByLabel('Caption script', { exact: true })
    .fill('These words belong to raw footage');
  // Simulate a stored reference created before caption analysis was available.
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('reel-studio-local-v1');
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction('assets', 'readwrite'),
        store = tx.objectStore('assets'),
        r = store.getAll();
      r.onsuccess = () => {
        for (const a of r.result)
          if (a.role === 'sample') {
            delete a.caption_analysis;
            store.put(a, a.id);
          }
      };
      tx.oncomplete = () => resolve();
    });
  });
  await page.getByRole('button', { name: 'Create storyboard', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Measured caption style', exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Approve & render', exact: true })).toBeEnabled({
    timeout: 60000,
  });
  const measured = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('reel-studio-local-v1');
      r.onsuccess = () => resolve(r.result);
    });
    const all: any[] = await new Promise((resolve) => {
      const r = db.transaction('projects').objectStore('projects').getAll();
      r.onsuccess = () => resolve(r.result);
    });
    const p = all.find((p) => p.name === 'Measured caption style');
    return {
      analysis: p.reference.caption_analysis,
      style: p.reels[0].editing.captions.style,
      captions: p.reels[0].caption_events,
    };
  });
  expect(measured.analysis.times).toHaveLength(24);
  expect(measured.analysis.times.every((t: number) => t >= 0 && t <= 5)).toBe(true);
  expect(measured.style.fill).toBe('#ffffff');
  expect(measured.style.stroke.width).toBe(0);
  expect(measured.style.box.per_line).toBe(true);
  expect(parseInt(measured.style.box.color.slice(3, 5), 16)).toBeGreaterThan(60);
  expect(parseInt(measured.style.box.color.slice(1, 3), 16)).toBeLessThan(15);
  expect(measured.style.size).toBeGreaterThan(35);
  expect(measured.style.size).toBeLessThan(60);
  expect(measured.captions.map((c: any) => c.text)).toEqual(['These words belong to raw footage']);
  expect(engineRequests).toBe(0);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('reel-studio-local-v1');
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction('projects', 'readwrite'),
        store = tx.objectStore('projects'),
        r = store.getAll();
      r.onsuccess = () => {
        const p = r.result.find((p) => p.name === 'Measured caption style');
        p.reference.mode = 'manual';
        delete p.reference.baselineVersion;
        delete p.reference.autoMatchAttempted;
        delete p.reference.autoMatchVersion;
        p.style.captions.style = { font: 'Manrope', weight: 700, size: 56, fill: '#ffe600' };
        for (const reel of p.reels) {
          reel.editing.captions.style = structuredClone(p.style.captions.style);
          reel.effective_style.captions.style = structuredClone(p.style.captions.style);
        }
        store.put(p, p.id);
      };
      tx.oncomplete = () => resolve();
    });
  });
  await page.reload();
  await expect(
    page.getByRole('region', { name: 'Reference caption status', exact: true }),
  ).toContainText('Reference captions applied · colour and pacing available on demand', {
    timeout: 30000,
  });
  await expect(page.getByRole('button', { name: 'Approve & render', exact: true })).toBeEnabled({
    timeout: 60000,
  });
  await expect(page.getByLabel('Caption font', { exact: true })).toHaveValue('Arial');
  await expect(page.getByLabel('Caption weight', { exact: true })).toHaveValue('400');
  await expect(page.getByLabel('Caption box colour', { exact: true })).not.toHaveValue('#ffe600');
  await expect(page.getByAltText('Caption cropped from your reference')).toBeVisible();
  await expect(page.getByAltText('Measured style rendered on sample wording')).toBeVisible();
  await page.getByLabel('Caption colour #f9a8d4', { exact: true }).click();
  await page.getByRole('button', { name: 'Update storyboard', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve & render', exact: true })).toBeEnabled({
    timeout: 60000,
  });
  await page.reload();
  await expect(page.getByLabel('Custom caption colour', { exact: true })).toHaveValue('#f9a8d4');
  await page.getByLabel('Caption colour #ffffff', { exact: true }).click();
  await page.getByRole('button', { name: 'Update storyboard', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve & render', exact: true })).toBeEnabled({
    timeout: 60000,
  });
  // An explicit reanalysis must inspect pixels again, rather than reuse a stale
  // cached analysis (including after the user supplies an original font).
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const q = indexedDB.open('reel-studio-local-v1');
      q.onsuccess = () => resolve(q.result);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction('assets', 'readwrite'),
        store = tx.objectStore('assets'),
        q = store.getAll();
      q.onsuccess = () => {
        for (const a of q.result)
          if (a.role === 'sample') {
            a.caption_analysis.style.fill = '#ff00ff';
            store.put(a, a.id);
          }
      };
      tx.oncomplete = () => resolve();
    });
  });
  const previousGeneration = (await storedProject(page, 'Measured caption style')).generation;
  await page
    .getByRole('button', { name: 'Refresh reference analysis & captions', exact: true })
    .click();
  await expect
    .poll(async () => (await storedProject(page, 'Measured caption style')).generation, {
      timeout: 30000,
    })
    .toBeGreaterThan(previousGeneration);
  await expect(page.getByRole('button', { name: 'Approve & render', exact: true })).toBeEnabled({
    timeout: 60000,
  });
  await expect(page.getByLabel('Custom caption colour', { exact: true })).toHaveValue('#ffffff');
  await page.getByRole('button', { name: 'Approve & render', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Accept passing renders', exact: true }),
  ).toBeVisible({ timeout: 120000 });
  await page.getByRole('button', { name: 'Accept passing renders', exact: true }).click();
  const event = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download r01.mp4', exact: true }).click();
  const file = testInfo.outputPath('styled.mp4');
  await (await event).saveAs(file);
  const rgb = execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-ss',
      '1',
      '-i',
      file,
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      'pipe:1',
    ],
    { maxBuffer: 4 * 1024 * 1024 },
  );
  let green = 0;
  for (let i = 0; i < rgb.length; i += 3)
    if (rgb[i + 1] > rgb[i] + 30 && rgb[i + 1] > rgb[i + 2] + 30) green++;
  expect(green).toBeGreaterThan(1000);
});

test('uncertain captions still allow measured colour and pacing, without a preset', async ({
  page,
}) => {
  await ready(page);
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /AA Bold/ }).click();
  await dialog
    .getByLabel('Reference reel', { exact: true })
    .setInputFiles(join(fixtures, 'reference.mp4'));
  await expect(dialog.getByRole('button', { name: 'Remove reference', exact: true })).toBeVisible({
    timeout: 30000,
  });
  await dialog
    .getByLabel('Raw footage', { exact: true })
    .setInputFiles(join(fixtures, 'source.mp4'));
  await expect(dialog.getByRole('alert')).toContainText('no preset is substituted');
  await expect(dialog.locator('.preset-grid')).toHaveCount(0);
  await expect(
    dialog.getByRole('button', { name: 'Create storyboard', exact: true }),
  ).toBeEnabled();
  await dialog.getByRole('button', { name: 'Remove reference', exact: true }).click();
  await expect(dialog.locator('.preset-grid')).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Create storyboard', exact: true }),
  ).toBeEnabled();
});

async function storedProject(page: any, name: string) {
  return page.evaluate(async (name: string) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const q = indexedDB.open('reel-studio-local-v1');
      q.onsuccess = () => resolve(q.result);
    });
    return new Promise<any>((resolve) => {
      const q = db.transaction('projects').objectStore('projects').getAll();
      q.onsuccess = () => resolve(q.result.find((p: any) => p.name === name));
    });
  }, name);
}
test('unboxed OCR, measured colour and fast pacing, custom font and conversational edits reach a real export', async ({
  page,
}, testInfo) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await ready(page);
  let engineRequests = 0;
  page.on('request', (r) => {
    if (r.url().includes('/engine/')) engineRequests++;
  });
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page
    .getByLabel('Reference reel', { exact: true })
    .setInputFiles(join(fixtures, 'unboxed-fast-reference.mp4'));
  await expect(
    page.getByText('Reference caption style detected — applied automatically', { exact: true }),
  ).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole('dialog')).toContainText('captions without a box');
  await page
    .getByLabel('Raw footage', { exact: true })
    .setInputFiles(join(fixtures, 'gray-raw.mp4'));
  await page.getByLabel('Project name', { exact: true }).fill('OCR colour pacing');
  await page.getByLabel('Caption script', { exact: true }).fill('Words from my raw recording.');
  await page.getByRole('button', { name: 'Create storyboard', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve & render', exact: true })).toBeEnabled({
    timeout: 60000,
  });
  await expect(page.getByRole('heading', { name: 'OCR colour pacing', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve & render', exact: true })).toBeEnabled({
    timeout: 60000,
  });
  let p = await storedProject(page, 'OCR colour pacing');
  const a = p.reference.caption_analysis;
  expect(a.method).toBe('ocr');
  expect(a.frames).toBe(24);
  expect(a.pacing.cuts.length).toBeGreaterThan(3);
  expect(a.style.box.color).toBe('');
  expect(parseInt(a.style.fill.slice(1, 3), 16)).toBeGreaterThan(200);
  expect(parseInt(a.style.fill.slice(3, 5), 16)).toBeGreaterThan(180);
  expect(parseInt(a.style.fill.slice(5, 7), 16)).toBeLessThan(50);
  expect(p.reels[0].segments).toEqual([{ src: 'A', s: 0, e: 4 }]);
  expect(p.reels[0].editing.colour).toBeUndefined();
  expect(p.reels[0].editing.pacing).toBeUndefined();
  let beforeCopy = p.generation;
  await page.getByRole('button', { name: 'Copy colour tone', exact: true }).click();
  await expect
    .poll(async () => (await storedProject(page, 'OCR colour pacing')).generation)
    .toBeGreaterThan(beforeCopy);
  await expect(page.getByRole('button', { name: 'Approve & render', exact: true })).toBeEnabled({
    timeout: 60000,
  });
  p = await storedProject(page, 'OCR colour pacing');
  expect(p.reels[0].segments).toEqual([{ src: 'A', s: 0, e: 4 }]);
  beforeCopy = p.generation;
  await page.getByRole('button', { name: 'Copy cuts & pacing', exact: true }).click();
  await expect
    .poll(async () => (await storedProject(page, 'OCR colour pacing')).generation)
    .toBeGreaterThan(beforeCopy);
  await expect(page.getByRole('button', { name: 'Approve & render', exact: true })).toBeEnabled({
    timeout: 60000,
  });
  p = await storedProject(page, 'OCR colour pacing');
  expect(p.reels[0].segments.length).toBeGreaterThan(3);
  expect(p.reels[0].duration).toBeCloseTo(4, 2);
  expect(p.reels[0].editing.pacing.reframes).toBe(true);
  expect(p.reels[0].editing.colour.strength).toBe(1);
  expect(p.reels[0].caption_events.map((c: any) => c.text).join(' ')).toBe(
    'Words from my raw recording.',
  );
  const rgb = await page
    .locator('.storyboard-stills img')
    .first()
    .evaluate(async (img: HTMLImageElement) => {
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const x = c.getContext('2d')!;
      x.drawImage(img, 0, 0);
      return [...x.getImageData(10, 10, 1, 1).data];
    });
  expect(rgb[0]).toBeGreaterThan(rgb[1] + 10);
  expect(engineRequests).toBe(0);
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await page
    .getByLabel('Message editing assistant', { exact: true })
    .fill('What did you detect in the reference?');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('log', { name: 'Editing conversation' })).toContainText(
    '24 sampled frames',
  );
  const generation = p.generation;
  await page.getByLabel('Message editing assistant', { exact: true }).fill('Warmer and faster');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByRole('button', { name: 'Apply & update storyboard', exact: true }).click();
  await expect
    .poll(async () => (await storedProject(page, 'OCR colour pacing')).generation)
    .toBeGreaterThan(generation);
  await expect(page.getByRole('button', { name: 'Approve & render', exact: true })).toBeEnabled({
    timeout: 60000,
  });
  p = await storedProject(page, 'OCR colour pacing');
  expect(p.reels[0].editing.colour.offset[0]).toBeGreaterThan(a.look.mean[0] - 128 * 0.8 - 2);
  await page.getByRole('tab', { name: 'Captions', exact: true }).click();
  await page
    .getByLabel('Import caption font', { exact: true })
    .setInputFiles('/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf');
  await expect(page.getByLabel('Caption font', { exact: true })).toHaveValue(/^Uploaded-/);
  const family = await page.getByLabel('Caption font', { exact: true }).inputValue();
  await page.getByRole('button', { name: 'Update storyboard', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve & render', exact: true })).toBeEnabled({
    timeout: 60000,
  });
  await page.reload();
  await expect(page.getByLabel('Caption font', { exact: true })).toHaveValue(family);
  expect(await page.evaluate((f) => document.fonts.check(`16px "${f}"`), family)).toBe(true);
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('Warmer and faster');
  expect(engineRequests).toBe(0);
  await page.getByRole('button', { name: 'Approve & render', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Accept passing renders', exact: true }),
  ).toBeVisible({ timeout: 120000 });
  await page.getByRole('button', { name: 'Accept passing renders', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download r01.mp4', exact: true }).click();
  const file = testInfo.outputPath('colour-pacing.mp4');
  await (await download).saveAs(file);
  const pixels = execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-ss',
      '1',
      '-i',
      file,
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      'pipe:1',
    ],
    { maxBuffer: 4 * 1024 * 1024 },
  );
  const probe = JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], {
      encoding: 'utf8',
    }),
  );
  expect(probe.streams.some((s: any) => s.codec_type === 'audio')).toBe(true);
  expect(+probe.format.duration).toBeGreaterThan(3.8);
  expect(+probe.format.duration).toBeLessThan(4.4);
  expect(pixels[0]).toBeGreaterThan(pixels[1] + 10);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('editing-chat.png'), fullPage: true });
});

test('outlined multiline captions are distinguished from neutral computer panels and small UI text', async ({
  page,
}) => {
  test.setTimeout(90000);
  await ready(page);
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page
    .getByLabel('Reference reel', { exact: true })
    .setInputFiles(join(fixtures, 'busy-outlined-reference.mp4'));
  await expect(
    page.getByText('Reference caption style detected — applied automatically', { exact: true }),
  ).toBeVisible({ timeout: 60000 });
  const a = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const q = indexedDB.open('reel-studio-local-v1');
      q.onsuccess = () => resolve(q.result);
    });
    return new Promise<any>((resolve) => {
      const q = db.transaction('assets').objectStore('assets').getAll();
      q.onsuccess = () => resolve(q.result.find((a: any) => a.role === 'sample').caption_analysis);
    });
  });
  expect(a.method).toBe('ocr');
  expect(a.style.box.color).toBe('');
  expect(a.style.fill).toBe('#ffffff');
  expect(a.style.weight).toBeGreaterThanOrEqual(700);
  expect(a.style.stroke.width).toBeGreaterThan(0);
  expect(Math.abs(a.style.x)).toBeLessThan(15);
  expect(a.style.y).toBeGreaterThan(220);
  expect(a.style.y).toBeLessThan(280);
  expect(a.ocr_text).toContain('CREATE');
  expect(a.ocr_text).toContain('HASSLE');
  expect(a.style.words_per_caption).toBeGreaterThanOrEqual(5);
});

test('control room copies each feature on demand, scopes targets, previews prompts, resets and undoes safely', async ({
  page,
}, testInfo) => {
  test.setTimeout(150000);
  await ready(page);
  let engineRequests = 0;
  page.on('request', (r) => {
    if (r.url().includes('/engine/')) engineRequests++;
  });
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page
    .getByLabel('Reference reel', { exact: true })
    .setInputFiles(join(fixtures, 'unboxed-fast-reference.mp4'));
  await expect(
    page.getByText('Reference caption style detected — applied automatically', { exact: true }),
  ).toBeVisible({ timeout: 60000 });
  await page
    .getByLabel('Raw footage', { exact: true })
    .setInputFiles(join(fixtures, 'gray-raw.mp4'));
  await page.getByLabel('Project name', { exact: true }).fill('Independent controls');
  await page.getByLabel('Number of reels', { exact: true }).fill('2');
  await page
    .getByLabel('Caption script', { exact: true })
    .fill('First reel words\nSecond reel words');
  await page.getByRole('button', { name: 'Create storyboard', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Independent controls', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve & render', exact: true })).toBeEnabled({
    timeout: 60000,
  });
  const room = page.getByRole('region', { name: 'Editing control room', exact: true });
  await room.getByRole('button', { name: 'Write tone instruction', exact: true }).click();
  await expect(room.getByLabel('Control room instruction', { exact: true })).toBeFocused();
  await expect(room.getByLabel('Control room editing area', { exact: true })).toHaveValue('colour');
  let p = await storedProject(page, 'Independent controls');
  const original = p.reels.map((r: any) => ({
    segments: r.segments,
    captions: r.editing.captions,
  }));
  for (const r of p.reels) {
    expect(r.editing.colour).toBeUndefined();
    expect(r.editing.pacing).toBeUndefined();
  }
  async function savedAfter(before: number) {
    await expect
      .poll(async () => (await storedProject(page, 'Independent controls')).generation, {
        timeout: 30000,
      })
      .toBeGreaterThan(before);
    await expect(page.getByRole('button', { name: 'Approve & render', exact: true })).toBeEnabled({
      timeout: 60000,
    });
    return storedProject(page, 'Independent controls');
  }
  await room.getByLabel('Tone copy strength', { exact: true }).fill('50');
  await room.getByRole('button', { name: 'Copy colour tone', exact: true }).click();
  p = await savedAfter(p.generation);
  expect(p.reels[0].editing.colour.strength).toBe(0.5);
  expect(p.reels[1].editing.colour).toBeUndefined();
  p.reels.forEach((r: any, i: number) => {
    expect(r.segments).toEqual(original[i].segments);
    expect(r.editing.captions).toEqual(original[i].captions);
  });
  const beforePace = p.generation,
    colour = structuredClone(p.reels[0].editing.colour);
  await room.getByRole('button', { name: 'Copy cuts & pacing', exact: true }).click();
  p = await savedAfter(beforePace);
  expect(p.reels[0].segments.length).toBeGreaterThan(1);
  expect(p.reels[0].editing.colour).toEqual(colour);
  expect(p.reels[1].segments).toEqual(original[1].segments);
  expect(p.reels[0].editing.captions).toEqual(original[0].captions);
  await room.getByRole('button', { name: 'Reset cuts', exact: true }).click();
  p = await savedAfter(p.generation);
  expect(p.reels[0].segments).toEqual(original[0].segments);
  await room.getByRole('button', { name: 'Reset tone', exact: true }).click();
  p = await savedAfter(p.generation);
  expect(p.reels[0].editing.colour.strength).toBe(0);
  await room.getByRole('button', { name: 'Undo last change', exact: true }).click();
  p = await savedAfter(p.generation);
  expect(p.reels[0].editing.colour).toEqual(colour);
  await room.getByLabel('Control room target', { exact: true }).selectOption('all');
  await room.getByLabel('Control room editing area', { exact: true }).selectOption('colour');
  await room
    .getByLabel('Control room instruction', { exact: true })
    .fill('Warmer and faster, yellow captions');
  await room.getByRole('button', { name: 'Preview instruction', exact: true }).click();
  await expect(room.getByLabel('Control room proposal', { exact: true })).toContainText(
    'only colour tone',
  );
  expect((await storedProject(page, 'Independent controls')).generation).toBe(p.generation);
  await room.getByRole('button', { name: 'Apply instruction', exact: true }).click();
  p = await savedAfter(p.generation);
  for (let i = 0; i < 2; i++) {
    expect(p.reels[i].editing.colour.strength).toBe(1);
    expect(p.reels[i].segments).toEqual(original[i].segments);
    expect(p.reels[i].editing.captions).toEqual(original[i].captions);
  }
  const customTone = structuredClone(p.reels.map((r: any) => r.editing.colour)),
    beforeRefresh = p.generation;
  await page
    .getByRole('button', { name: 'Refresh reference analysis & captions', exact: true })
    .click();
  p = await savedAfter(beforeRefresh);
  for (let i = 0; i < 2; i++) {
    expect(p.reels[i].editing.colour).toEqual(customTone[i]);
    expect(p.reels[i].segments).toEqual(original[i].segments);
  }
  // Stage a proposal, then change the plan to prove the stale proposal cannot apply.
  await room.getByLabel('Control room instruction', { exact: true }).fill('Cooler');
  await room.getByRole('button', { name: 'Preview instruction', exact: true }).click();
  await expect(room.getByRole('button', { name: 'Apply instruction', exact: true })).toBeEnabled();
  await page.getByRole('tab', { name: 'Captions', exact: true }).click();
  await page.getByLabel('Caption colour #f9a8d4', { exact: true }).click();
  await page.getByRole('button', { name: 'Update storyboard', exact: true }).click();
  p = await savedAfter(p.generation);
  await expect(room.getByRole('button', { name: 'Apply instruction', exact: true })).toBeDisabled();
  const pinkStyle = structuredClone(p.reels[0].editing.captions),
    beforeCopyCaption = p.generation;
  await room.getByLabel('Control room target', { exact: true }).selectOption('r01');
  await room.getByRole('button', { name: 'Copy caption style', exact: true }).click();
  p = await savedAfter(beforeCopyCaption);
  expect(p.reels[0].editing.captions).not.toEqual(pinkStyle);
  expect(p.reels[0].editing.colour).toEqual(customTone[0]);
  expect(p.reels[0].segments).toEqual(original[0].segments);
  expect(engineRequests).toBe(0);
  await room.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('control-room-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await room.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('control-room-mobile.png'), fullPage: true });
});
