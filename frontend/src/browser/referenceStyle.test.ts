import { describe, expect, it } from 'vitest';
import { boxedCaptionPixels } from './referenceStyle';
function image() {
  const w = 360,
    h = 640,
    data = new Uint8ClampedArray(w * h * 4);
  data.fill(255);
  const fill = (x: number, y: number, width: number, height: number, rgb: number[]) => {
    for (let a = y; a < y + height; a++)
      for (let b = x; b < x + width; b++) {
        const i = (a * w + b) * 4;
        data[i] = rgb[0];
        data[i + 1] = rgb[1];
        data[i + 2] = rgb[2];
      }
  };
  return { w, h, data, fill };
}
describe('bounded reference caption measurement', () => {
  it('finds a solid green backplate with white text-shaped holes and measures its placement', () => {
    const { w, h, data, fill } = image();
    fill(60, 335, 240, 35, [0, 75, 6]);
    for (const x of [
      74, 80, 86, 92, 105, 111, 117, 123, 136, 142, 148, 154, 167, 173, 179, 185, 198, 204, 210,
      216,
    ])
      fill(x, 345, 3, 14, [255, 255, 255]);
    const result = boxedCaptionPixels(data, w, h);
    expect(result).not.toBeNull();
    expect(result!.colour).toEqual([0, 75, 6]);
    expect(result!.y).toBeCloseTo(351.5 / 640, 2);
    expect(result!.size).toBeGreaterThan(30);
    expect(result!.size).toBeLessThan(50);
  });
  it('does not claim a plain frame or a large coloured scene object is a caption', () => {
    const { w, h, data, fill } = image();
    expect(boxedCaptionPixels(data, w, h)).toBeNull();
    fill(80, 180, 170, 300, [0, 75, 6]);
    expect(boxedCaptionPixels(data, w, h)).toBeNull();
  });
});
