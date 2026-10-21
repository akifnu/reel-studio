import { useEffect, useState } from 'react';
import type { CaptionAnalysis, Reel, TextStyle } from './types';

export default function CaptionStylePreview({
  analysis,
  style,
  label = 'Applied caption style',
}: {
  analysis?: CaptionAnalysis;
  style?: TextStyle;
  label?: string;
}) {
  const [image, setImage] = useState('');
  const key = JSON.stringify(style);
  useEffect(() => {
    let active = true;
    if (!style) {
      setImage('');
      return;
    }
    void import('./browser/compositor').then(async ({ captionCanvas }) => {
      await document.fonts.ready;
      const reel = {
        effective_style: { captions: { style } },
        editing: { captions: { style } },
      } as Reel;
      const canvas = captionCanvas(reel, 'Your captions appear here', 360, 640),
        ctx = canvas.getContext('2d')!,
        data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let left = canvas.width,
        right = 0,
        top = canvas.height,
        bottom = 0;
      for (let y = 0; y < canvas.height; y++)
        for (let x = 0; x < canvas.width; x++)
          if (data[(y * canvas.width + x) * 4 + 3]) {
            left = Math.min(left, x);
            right = Math.max(right, x);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
          }
      if (left > right) return;
      const margin = 5,
        x = Math.max(0, left - margin),
        y = Math.max(0, top - margin),
        crop = document.createElement('canvas');
      crop.width = Math.min(canvas.width - x, right - left + 1 + 2 * margin);
      crop.height = Math.min(canvas.height - y, bottom - top + 1 + 2 * margin);
      crop
        .getContext('2d')!
        .drawImage(canvas, x, y, crop.width, crop.height, 0, 0, crop.width, crop.height);
      if (active) setImage(crop.toDataURL());
    });
    return () => {
      active = false;
    };
  }, [key]);
  if (!style) return null;
  return (
    <div className="caption-style-comparison" aria-label="Reference caption style comparison">
      {analysis?.preview && (
        <figure>
          <figcaption>Detected in reference · {analysis.preview.t.toFixed(1)}s</figcaption>
          <div>
            <img src={analysis.preview.image} alt="Caption cropped from your reference" />
          </div>
        </figure>
      )}
      <figure>
        <figcaption>{label}</figcaption>
        <div>{image && <img src={image} alt="Measured style rendered on sample wording" />}</div>
        <small>Style sample; wording comes from your raw footage.</small>
      </figure>
    </div>
  );
}
