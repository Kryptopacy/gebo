/**
 * Build GEBO's logo assets from the source JPEG.
 *
 * The source is named "transparent" but is a 24-bit JPEG — JPEG cannot store an
 * alpha channel, so the mark arrives as gold on solid black. Dropping that onto
 * GEBO's near-black canvas (#08090b) would show a visible black patch.
 *
 * Because the artwork is effectively already premultiplied against black, real
 * transparency can be recovered rather than approximated:
 *
 *   alpha = max(r, g, b)              — preserves saturated golds better than
 *                                       luminance, which under-weights warm hues
 *   rgb   = rgb * 255 / alpha         — un-premultiply, restoring vivid colour
 *
 * This keeps the antialiased edges intact, which a hard black-to-transparent
 * threshold would destroy.
 *
 * Outputs use Next.js App Router file conventions so the framework wires the
 * <link> tags itself:
 *   app/icon.png              -> favicon (Next derives the smaller sizes)
 *   app/apple-icon.png        -> iOS home screen, 180x180
 *   app/opengraph-image.png   -> social preview, 1200x630
 *   public/gebo-mark.png      -> in-page use (masthead)
 */
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import path from "node:path";

const SRC = process.argv[2] ?? "C:\\Users\\dev.zoro\\Downloads\\gebo_logo_transparent.jpeg";
const INK = { r: 8, g: 9, b: 11 }; // --ink-900

mkdirSync("public", { recursive: true });
mkdirSync("app", { recursive: true });

// ── 1. recover alpha from the black-matted source ─────────────────────────
const { data, info } = await sharp(SRC).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;
console.log(`\n  source        ${width}x${height}, ${channels}ch`);

const rgba = Buffer.alloc(width * height * 4);
let opaque = 0;
for (let i = 0, j = 0; i < data.length; i += channels, j += 4) {
  const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
  const a = Math.max(r, g, b);
  if (a === 0) {
    rgba[j] = 0; rgba[j + 1] = 0; rgba[j + 2] = 0; rgba[j + 3] = 0;
    continue;
  }
  const k = 255 / a;
  rgba[j] = Math.min(255, Math.round(r * k));
  rgba[j + 1] = Math.min(255, Math.round(g * k));
  rgba[j + 2] = Math.min(255, Math.round(b * k));
  rgba[j + 3] = a;
  if (a > 8) opaque++;
}
console.log(`  visible px    ${((opaque / (width * height)) * 100).toFixed(1)}%`);

// ── 2. trim the transparent margin, then pad to a square ──────────────────
const trimmed = await sharp(rgba, { raw: { width, height, channels: 4 } })
  .png()
  .trim({ threshold: 6 })
  .toBuffer({ resolveWithObject: true });

console.log(`  trimmed       ${trimmed.info.width}x${trimmed.info.height}`);

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

console.log(`  squared       ${side}x${side}`);

// ── 3. report the brand colour so the UI accent can be locked to it ───────
// The design system permits exactly one accent. If the logo's gold and the
// CSS accent differ, they clash subtly on every page, so the artwork defines
// the token rather than competing with it.
{
  const { data: sd, info: si } = await sharp(square).raw().toBuffer({ resolveWithObject: true });
  let r = 0, g = 0, b = 0, n = 0;
  let br = 0, bg = 0, bb = 0, bl = -1;
  for (let i = 0; i < sd.length; i += si.channels) {
    const a = si.channels === 4 ? sd[i + 3]! : 255;
    if (a < 200) continue;
    const pr = sd[i]!, pg = sd[i + 1]!, pb = sd[i + 2]!;
    r += pr; g += pg; b += pb; n++;
    const lum = 0.299 * pr + 0.587 * pg + 0.114 * pb;
    if (lum > bl) { bl = lum; br = pr; bg = pg; bb = pb; }
  }
  const hex = (x: number) => x.toString(16).padStart(2, "0");
  if (n) {
    const mean = `#${hex(Math.round(r / n))}${hex(Math.round(g / n))}${hex(Math.round(b / n))}`;
    const bright = `#${hex(br)}${hex(bg)}${hex(bb)}`;
    console.log(`  brand colour  mean ${mean}  brightest ${bright}  (over ${n.toLocaleString()} opaque px)`);
  }
}

// ── 4. emit assets ────────────────────────────────────────────────────────
async function emit(file: string, size: number, padPct: number) {
  // Favicons need breathing room or they read as a solid blob at 16px.
  // Derive the inner box from the pad so the final canvas is exactly `size`.
  const pad = Math.round(size * padPct);
  const inner = size - pad * 2;
  await sharp(square)
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: "lanczos3" })
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    // Palette quantisation cuts a flat-colour mark from ~400 KB to tens of KB
    // with no visible loss. A 400 KB favicon is a real LCP cost.
    .png({ palette: true, quality: 90, effort: 10, compressionLevel: 9 })
    .toFile(file);
  const { size: bytes } = await import("node:fs").then((m) => m.statSync(file));
  console.log(`  wrote         ${file.padEnd(28)} ${size}x${size}  ${(bytes / 1024).toFixed(0)} KB`);
}

await emit(path.join("public", "gebo-mark.png"), 256, 0.02);
await emit(path.join("app", "icon.png"), 256, 0.06);
await emit(path.join("app", "apple-icon.png"), 180, 0.10);

// Open Graph: a branded card, not a bare mark. The previous version was the
// mark centred on near-black — technically the logo, but in dark-mode share
// previews it read as an empty rectangle, which is how "the site has no OG
// image" got reported despite the tag being correct. Wordmark + tagline make
// the card legible in any embed. SVG text renders through sharp's bundled
// libvips; this script runs on the asset-building machine, not in CI, so the
// local font stack (Segoe UI/Arial) is available.
const ogMark = await sharp(square)
  .resize(230, 230, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: "lanczos3" })
  .png()
  .toBuffer();

const OG_W = 1200, OG_H = 630, MARK = 230, MARK_TOP = 195;
const ogSvg = Buffer.from(`
<svg width="${OG_W}" height="${OG_H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${OG_W}" height="${OG_H}" fill="#0a0c0f"/>
  <rect x="10" y="10" width="${OG_W - 20}" height="${OG_H - 20}" fill="none" stroke="#f0b90b" stroke-opacity="0.3" stroke-width="2" rx="18"/>
  <text x="${OG_W / 2}" y="105" text-anchor="middle"
        font-family="Segoe UI, Arial, sans-serif" font-size="72" font-weight="700"
        fill="#f0b90b" letter-spacing="14">GEBO</text>
  <text x="${OG_W / 2}" y="152" text-anchor="middle"
        font-family="Segoe UI, Arial, sans-serif" font-size="22"
        fill="#9aa3b2" letter-spacing="3">VERIFICATION-FIRST AGENT REGISTRY · BNB SMART CHAIN</text>
  <text x="${OG_W / 2}" y="508" text-anchor="middle"
        font-family="Segoe UI, Arial, sans-serif" font-size="27"
        fill="#e7e3d8">is this agent alive · what can it do to my wallet</text>
  <text x="${OG_W / 2}" y="552" text-anchor="middle"
        font-family="Segoe UI, Arial, sans-serif" font-size="27"
        fill="#e7e3d8">did hiring it beat doing the job myself</text>
  <text x="${OG_W / 2}" y="596" text-anchor="middle"
        font-family="Segoe UI, Arial, sans-serif" font-size="18"
        fill="#6b7280">gebo-bsc.vercel.app</text>
</svg>`);

await sharp({
  create: { width: OG_W, height: OG_H, channels: 4, background: { r: 10, g: 12, b: 15, alpha: 1 } },
})
  .composite([
    { input: ogSvg, top: 0, left: 0 },
    { input: ogMark, top: MARK_TOP, left: Math.round((OG_W - MARK) / 2) },
  ])
  .png({ compressionLevel: 9 })
  .toFile(path.join("app", "opengraph-image.png"));
console.log(`  wrote         app/opengraph-image.png      ${OG_W}x${OG_H}  (branded card)`);

console.log("");
