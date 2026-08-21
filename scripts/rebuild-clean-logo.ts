import sharp from "sharp";
import path from "node:path";
import { statSync } from "node:fs";

async function main() {
  const SRC = path.join(process.cwd(), "public", "gebo_source.jpeg");
  const { data, info } = await sharp(SRC).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  console.log(`Source: ${width}x${height}, ${channels} channels`);

  // Create a 2D grid for visited / background mask
  const isBg = new Uint8Array(width * height);
  const queue: number[] = [];

  const getIdx = (x: number, y: number) => y * width + x;
  const isBlack = (x: number, y: number) => {
    const p = (y * width + x) * channels;
    const r = data[p]!;
    const g = data[p + 1]!;
    const b = data[p + 2]!;
    return r < 20 && g < 20 && b < 20;
  };

  // Seed boundary
  for (let x = 0; x < width; x++) {
    if (isBlack(x, 0)) { isBg[getIdx(x, 0)] = 1; queue.push(x, 0); }
    if (isBlack(x, height - 1)) { isBg[getIdx(x, height - 1)] = 1; queue.push(x, height - 1); }
  }
  for (let y = 0; y < height; y++) {
    if (isBlack(0, y)) { isBg[getIdx(0, y)] = 1; queue.push(0, y); }
    if (isBlack(width - 1, y)) { isBg[getIdx(width - 1, y)] = 1; queue.push(width - 1, y); }
  }

  // BFS Flood Fill from edges inwards
  let head = 0;
  while (head < queue.length) {
    const x = queue[head++]!;
    const y = queue[head++]!;

    // Typed as a tuple so destructuring yields numbers rather than
    // number | undefined, which noUncheckedIndexedAccess would otherwise infer
    // from a number[][] and which fails the build.
    const neighbors: [number, number][] = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ];

    for (const [nx, ny] of neighbors) {
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nIdx = getIdx(nx, ny);
        if (!isBg[nIdx] && isBlack(nx, ny)) {
          isBg[nIdx] = 1;
          queue.push(nx, ny);
        }
      }
    }
  }

  // Build RGBA buffer: Background is transparent (alpha = 0), artwork is 100% OPAQUE (alpha = 255)
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = getIdx(x, y);
      const srcP = idx * channels;
      const dstP = idx * 4;

      const r = data[srcP]!;
      const g = data[srcP + 1]!;
      const b = data[srcP + 2]!;

      rgba[dstP] = r;
      rgba[dstP + 1] = g;
      rgba[dstP + 2] = b;

      if (isBg[idx]) {
        rgba[dstP + 3] = 0; // External black background -> transparent
      } else {
        rgba[dstP + 3] = 255; // Interior artwork -> 100% solid & vibrant
      }
    }
  }

  // Trim transparent padding and pad to square
  const trimmed = await sharp(rgba, { raw: { width, height, channels: 4 } })
    .png()
    .trim({ threshold: 5 })
    .toBuffer({ resolveWithObject: true });

  const side = Math.max(trimmed.info.width, trimmed.info.height);
  const square = await sharp(trimmed.data)
    .extend({
      top: Math.floor((side - trimmed.info.height) / 2),
      bottom: Math.ceil((side - trimmed.info.height) / 2),
      left: Math.floor((side - trimmed.info.width) / 2),
      right: Math.ceil((side - trimmed.info.width) / 2),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  async function emit(file: string, size: number, padPct: number) {
    const pad = Math.round(size * padPct);
    const inner = size - pad * 2;
    await sharp(square)
      .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: "lanczos3" })
      .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ quality: 100, compressionLevel: 9 })
      .toFile(file);
    const { size: bytes } = statSync(file);
    console.log(`Wrote ${file} (${size}x${size}, ${(bytes / 1024).toFixed(1)} KB)`);
  }

  await emit(path.join("public", "gebo-mark.png"), 512, 0.02);
  await emit(path.join("app", "icon.png"), 256, 0.04);
  await emit(path.join("app", "apple-icon.png"), 180, 0.06);

  console.log("Logo successfully rebuilt with 100% solid interior artwork!");
}

main().catch(console.error);
