import { all, hash, put } from './store';
import type { LocalAsset } from './store';
export const fontFamilies = [
  'Manrope',
  'DM Sans',
  'Arial',
  'Georgia',
  'Impact',
  'Trebuchet MS',
  'Courier New',
  'Times New Roman',
];
async function register(a: LocalAsset) {
  const name = 'Uploaded-' + a.digest!.slice(0, 16);
  const face = new FontFace(name, await a.blob.arrayBuffer());
  await face.load();
  document.fonts.add(face);
  if (!fontFamilies.includes(name)) fontFamilies.push(name);
  return name;
}
export async function loadCustomFonts() {
  for (const a of await all<LocalAsset>('assets'))
    if (a.role === 'font') await register(a).catch(() => {});
}
export async function importFont(file: File) {
  if (!/\.(ttf|otf|woff2?)$/i.test(file.name) || file.size > 5 * 1024 * 1024)
    throw new Error('Choose a TTF, OTF, WOFF or WOFF2 font under 5 MB.');
  const digest = await hash(file),
    a: LocalAsset = {
      id: 'font-' + digest,
      digest,
      name: file.name,
      role: 'font',
      bytes: file.size,
      blob: file,
      width: 0,
      height: 0,
      duration: 0,
    };
  const name = await register(a);
  await put('assets', a.id, a);
  return name;
}
