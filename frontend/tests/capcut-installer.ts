import { expect, type BrowserContext } from '@playwright/test';
export async function checkOfflineInstaller(
  context: BrowserContext,
  files: Record<string, Uint8Array>,
) {
  const page = await context.newPage();
  const template = {
    id: 'native-empty-project',
    platform: { app_version: '9.3.0', os: 'windows' },
    last_modified_platform: { app_version: '9.3.0' },
    version: 999999,
    tracks: [],
    materials: { videos: [], audios: [], texts: [], filters: [] },
    retained_app_flag: 'retained',
  };
  const meta = {
    draft_id: 'native-empty-project',
    draft_fold_path: 'C:/CapCut/empty-draft',
    draft_name: 'Empty',
    draft_materials: [],
  };
  const source = Object.fromEntries(
    Object.entries(files)
      .filter(([name]) => name.startsWith('media/'))
      .map(([name, bytes]) => [name, Array.from(bytes)]),
  );
  await page.addInitScript(
    ({ source, template, meta }) => {
      const data = new Map<string, Uint8Array>(),
        directories = new Set([
          'source',
          'source/media',
          'target',
          'target/Timelines',
          'target/Timelines/native-timeline',
        ]);
      const encoder = new TextEncoder();
      for (const [name, bytes] of Object.entries(source))
        data.set('source/' + name, new Uint8Array(bytes));
      data.set('target/draft_content.json', encoder.encode(JSON.stringify(template)));
      data.set(
        'target/Timelines/native-timeline/draft_content.json',
        encoder.encode(JSON.stringify({ ...template, id: 'native-timeline' })),
      );
      data.set('target/draft_meta_info.json', encoder.encode(JSON.stringify(meta)));
      const missing = () => {
        throw new DOMException('Not found', 'NotFoundError');
      };
      function directory(path: string): any {
        return {
          kind: 'directory',
          name: path === 'target' ? 'empty-draft' : path.split('/').at(-1),
          async getDirectoryHandle(name: string, options?: { create?: boolean }) {
            const next = path + '/' + name;
            if (!directories.has(next)) {
              if (!options?.create) missing();
              directories.add(next);
            }
            return directory(next);
          },
          async getFileHandle(name: string, options?: { create?: boolean }) {
            const key = path + '/' + name;
            if (!data.has(key) && !options?.create) missing();
            return {
              async getFile() {
                if (!data.has(key)) missing();
                return new File([data.get(key)! as any], name);
              },
              async createWritable() {
                let pending = data.get(key)!;
                return {
                  async write(value: any) {
                    pending =
                      typeof value === 'string'
                        ? encoder.encode(value)
                        : value instanceof Blob
                          ? new Uint8Array(await value.arrayBuffer())
                          : new Uint8Array(value);
                  },
                  async close() {
                    data.set(key, pending);
                  },
                  async abort() {},
                };
              },
            };
          },
          async *values() {
            for (const child of directories)
              if (child.startsWith(path + '/') && child.slice(path.length + 1).indexOf('/') < 0)
                yield directory(child);
          },
        };
      }
      let pick = 0;
      (window as any).showDirectoryPicker = async () =>
        directory(pick++ === 0 ? 'source' : 'target');
      (window as any).__installed = (path: string) =>
        JSON.parse(new TextDecoder().decode(data.get('target/' + path)));
    },
    { source, template, meta },
  );
  const html = new TextDecoder().decode(files['Install in CapCut.html']);
  await page.route('**/capcut-installer-check', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.goto('/capcut-installer-check');
  await page
    .getByRole('button', { name: '1. Choose extracted export folder', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText('Export folder selected');
  await page
    .getByRole('button', { name: '2. Choose empty CapCut project and install', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText('Installed. Reopen', { timeout: 30000 });
  const result = await page.evaluate(() => ({
    root: (window as any).__installed('draft_content.json'),
    mirror: (window as any).__installed('Timelines/native-timeline/draft_content.json'),
    meta: (window as any).__installed('draft_meta_info.json'),
  }));
  expect(result.root.id).toBe('native-empty-project');
  expect(result.mirror.id).toBe('native-timeline');
  expect(result.root.version).toBe(999999);
  expect(result.root.retained_app_flag).toBe('retained');
  expect(result.root.tracks[0].segments).toHaveLength(2);
  expect(result.root.materials.videos[0].path).toMatch(
    /^C:\/CapCut\/empty-draft\/ReelStudio-media\//,
  );
  expect(result.meta.draft_materials[0].value[0].file_Path).toBe(
    result.root.materials.videos[0].path,
  );
  expect(result.mirror.tracks).toEqual(result.root.tracks);
  await page.close();
}
