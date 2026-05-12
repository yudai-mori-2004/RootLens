import sharp from "sharp";
import fs from "node:fs";

const SRC = "/tmp/gen-out/";
const DST = "/Users/forest/WebCreations/root-lens/web/public/lp/";

const items = [
  { src: "v3-p-a.png", dst: "problem.webp", crop: { left: 200, top: 350, width: 624, height: 600 }, w: 600 },
  { src: "v3-s1-a.png", dst: "step-record.webp", w: 400 },
  { src: "v3-s2-a.png", dst: "step-validate.webp", w: 400 },
  { src: "v3-s3-a.png", dst: "step-earn.webp", w: 400 },
  { src: "v3-cta-a.png", dst: "cta.webp", w: 600 },
];

// Convert cream/warm background pixels to transparent
async function transparentize(buffer) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    // Cream background range: ~248-255, 246-252, 230-244
    // Treat anything bright (luminance > 220) as background candidate
    const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
    if (brightness > 215) {
      // Smooth alpha based on brightness (anti-aliasing on edges)
      const alpha = Math.max(0, Math.min(255, (240 - brightness) * 12));
      data[i + 3] = alpha;
    }
  }

  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
}

for (const item of items) {
  let pipeline = sharp(SRC + item.src);
  if (item.crop) {
    pipeline = pipeline.extract(item.crop);
  }
  const cropped = await pipeline.toBuffer();
  const transparent = await transparentize(cropped);
  await transparent
    .resize({ width: item.w, withoutEnlargement: true })
    .webp({ quality: 85, alphaQuality: 90 })
    .toFile(DST + item.dst);
  const stat = fs.statSync(DST + item.dst);
  console.log(`${item.dst}: ${(stat.size / 1024).toFixed(0)}KB`);
}
