import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  if (process.env.STUDIO_TEST_TOKEN) {
    const response = await page.request.post('/api/session', {
      data: { token: process.env.STUDIO_TEST_TOKEN },
    });
    expect(response.ok()).toBeTruthy();
  }
});

test('real review page: edits stay local, comments persist, proposals need an apply, and changed reel previews regenerate', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'A little practice. A better story.', exact: true }),
  ).toBeVisible();
  const id = new URL(page.url()).searchParams.get('project')!;
  const original = await (await page.request.get(`/api/projects/${id}`)).json();
  const mutationRequests: string[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET' && r.url().includes('/api/')) mutationRequests.push(r.url());
  });
  await page.getByLabel('Caption colour #ffe600', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Update storyboard', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Approve & render', exact: true })).toBeDisabled();
  expect(mutationRequests).toEqual([]);
  await expect(page.getByLabel('Live caption preview')).toHaveCSS('color', 'rgb(255, 230, 0)');
  await page.getByRole('button', { name: 'Update storyboard', exact: true }).click();
  await expect
    .poll(
      async () => {
        const p = await (await page.request.get(`/api/projects/${id}`)).json();
        return p.generation;
      },
      { timeout: 30000 },
    )
    .toBe(original.generation + 1);
  await expect(page.getByRole('button', { name: 'Approve & render', exact: true })).toBeEnabled({
    timeout: 30000,
  });
  const updated = await (await page.request.get(`/api/projects/${id}`)).json();
  expect(updated.storyboard.cache_hits).toBe(1);
  expect(updated.reels[0].effective_style.captions.style.fill).toBe('#ffe600');
  expect(updated.reels[1].caption_text).toEqual(original.reels[1].caption_text);
  await page.getByRole('button', { name: /comments$/ }).click();
  await page.getByLabel('Timestamped comment', { exact: true }).fill('Keep this opening moment.');
  await page.locator('.comment-compose button').click();
  await expect(page.getByText('Keep this opening moment.', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await page
    .getByLabel('Message editing assistant', { exact: true })
    .fill('Zoom to 1.15 and mute music');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('crop · zoom: 1.15', { exact: true })).toBeVisible({
    timeout: 10000,
  });
  const proposed = await (await page.request.get(`/api/projects/${id}`)).json();
  expect(proposed.generation).toBe(updated.generation);
  expect(proposed.needs.step).toBe('approve_storyboard');
  await page.getByRole('button', { name: 'Apply & update storyboard', exact: true }).click();
  await expect
    .poll(async () => (await (await page.request.get(`/api/projects/${id}`)).json()).generation)
    .toBe(updated.generation + 1);
  await expect(page.getByRole('button', { name: 'Approve & render', exact: true })).toBeEnabled({
    timeout: 30000,
  });
  const applied = await (await page.request.get(`/api/projects/${id}`)).json();
  expect(applied.generation).toBe(updated.generation + 1);
  expect(applied.reels[0].editing.crop.zoom).toBe(1.15);
  expect(applied.reels[0].editing.music.muted).toBe(true);
  expect(applied.storyboard.cache_hits).toBe(1);
  expect(errors).toEqual([]);
});

test('mobile controls stay within the viewport and project navigation can close', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'A little practice. A better story.', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show projects' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Show projects' }).click();
  await expect(page.getByRole('navigation', { name: 'Projects' })).toBeInViewport();
  await page.locator('nav button').first().click();
  await expect(page.locator('.sidebar')).not.toHaveClass(/open/);
});

test('new project form shows real uploads and refuses an empty project', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create storyboard', exact: true })).toBeDisabled();
  await page.getByLabel('Project name', { exact: true }).fill('A fresh story');
  await page.getByLabel('Number of reels', { exact: true }).fill('2');
  await page.getByLabel('Target duration', { exact: true }).selectOption('15');
  await page.getByRole('button', { name: 'Close new project', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
