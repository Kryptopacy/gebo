/**
 * Verify the generated logo assets: real alpha, correct dimensions, and a
 * transparent border rather than a black matte.
 */
import sharp from "sharp";
import { statSync } from "node:fs";

const files = [
  "public/gebo-mark.png",
  "app/icon.png",
  "app/apple-icon.png",
  "app/opengraph-image.png",
];

console.log("");
for (const f of files) {
  const img = sharp(f);
  const m = await img.metadata();
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = (x: number, y: number) => {
    const i = (y * info.width + x) * info.channels;
    return { r: data[i]!, g: data[i + 1]!, b: data[i + 2]!, a: data[i + 3]! };
  };

  const corner = px(1, 1);
  const centre = px(Math.floor(info.width / 2), Math.floor(info.height / 2));

  // How much of the canvas is fully transparent?
  let clear = 0;
  for (let i = 3; i < data.length; i += info.channels) if (data[i]! === 0) clear++;
  const clearPct = (clear / (info.width * info.height)) * 100;

  const kb = (statSync(f).size / 1024).toFixed(0);
  console.log(`  ${f}`);
  console.log(`    ${m.width}x${m.height}  ${m.channels}ch  alpha=${m.hasAlpha}  ${kb} KB`);
  console.log(`    corner  rgba(${corner.r},${corner.g},${corner.b},${corner.a})`);
  console.log(`    centre  rgba(${centre.r},${centre.g},${centre.b},${centre.a})`);
  console.log(`    fully transparent: ${clearPct.toFixed(1)}%`);
  console.log("");
}
