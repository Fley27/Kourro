#!/usr/bin/env node
/**
 * Generates the Kourro brand assets from scratch (outlined paths, no <text>):
 *   - logo.svg / logo-white.svg / logo-dark.svg   (wordmark + "BUILT TO DELIVER")
 *   - favicon.svg                                 (rounded-square K monogram)
 *   - raster sets: PNG/WebP/AVIF wordmark, favicons, app icons
 *
 * Type: Archivo Black (OFL — see scripts/brand/OFL.txt)
 * Usage: node scripts/generate-brand.mjs [--preview]
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FONT = path.join(ROOT, "scripts/brand/ArchivoBlack-Regular.ttf");

const ORANGE = "#ff5f1a";
const INK = "#15120b";
const WHITE = "#ffffff";

const WM_W = 489;
const WM_H = 128;

const font = (() => {
  const buf = fs.readFileSync(FONT);
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
})();
const capRatio = (() => {
  const bb = font.charToGlyph("K").getPath(0, 0, 1000).getBoundingBox();
  return -bb.y1 / 1000;
})();

/* ---------------------------------------------------------------- helpers */

/** Lay out `text` on one line with per-gap tracking (em). Returns path + bbox. */
function layout(text, size, trackingEm) {
  const glyphs = font.stringToGlyphs(text);
  const scale = size / font.unitsPerEm;
  const tracking = trackingEm * size;
  let x = 0;
  const commands = [];
  // opentype.js 2.0's toPathData emits NaN for near-integer float noise
  // (e.g. 214.00000000000003), so snap coordinates before serialising.
  const snap = (v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v);
  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i];
    for (const c of g.getPath(x, 0, size).commands) {
      const c2 = { type: c.type };
      for (const k of Object.keys(c)) if (k !== "type") c2[k] = snap(c[k]);
      commands.push(c2);
    }
    x += (g.advanceWidth || 0) * scale;
    if (i < glyphs.length - 1) {
      x += font.getKerningValue(g, glyphs[i + 1]) * scale + tracking;
    }
  }
  const combined = new opentype.Path();
  combined.commands = commands;
  return { d: combined.toPathData(2), width: x, bbox: combined.getBoundingBox() };
}

/** bbox width of a layout at size 100 (used to solve scale/tracking). */
const bboxW = (text, size, tr) => {
  const l = layout(text, size, tr);
  return l.bbox.x2 - l.bbox.x1;
};

/** Solve tracking (em) so `text`'s bbox spans `targetW` at `size`. */
function solveTracking(text, size, targetW) {
  let tr = 0.2;
  for (let i = 0; i < 8; i++) {
    const w = bboxW(text, size, tr);
    if (Math.abs(w - targetW) < 0.2) break;
    tr += ((targetW - w) * tr) / w || 0.05;
    tr = Math.max(0, Math.min(tr, 3));
  }
  return tr;
}

/* --------------------------------------------------------------- wordmark */

/**
 * "KOURRO" + "BUILT TO DELIVER" lockup in a WM_W x WM_H box.
 * Wordmark: filled to the width margins. Tagline: same layout as the original
 * (small caps, letterspaced, centered under the wordmark).
 */
function wordmarkPaths(color, outline) {
  const padX = 10;
  const top = 10;
  const targetW = WM_W - padX * 2;
  const maxCap = 78; // wordmark cap height budget (leaves room for tagline)

  // fit wordmark by width, clamp by cap-height budget
  let size = 100;
  let scale = targetW / bboxW("KOURRO", 100, -0.015);
  if (100 * scale * capRatio > maxCap) scale = maxCap / (100 * capRatio);
  size = 100 * scale;
  const wm = layout("KOURRO", size, -0.015);
  const wmW = wm.bbox.x2 - wm.bbox.x1;
  const wmX = (WM_W - wmW) / 2 - wm.bbox.x1;
  const base1 = top - wm.bbox.y1; // bbox top lands on `top`
  const wmBottom = base1 + wm.bbox.y2;

  // tagline: cap height ~19, tracked out to 90% of the wordmark width
  const tagCap = 19;
  const tagSize = tagCap / capRatio;
  const tagTargetW = wmW * 0.9;
  const tagTr = solveTracking("BUILT TO DELIVER", tagSize, tagTargetW);
  const tag = layout("BUILT TO DELIVER", tagSize, tagTr);
  const tagW = tag.bbox.x2 - tag.bbox.x1;
  const tagTop = wmBottom + 20;
  const tagBase = tagTop - tag.bbox.y1;
  const tagX = (WM_W - tagW) / 2 - tag.bbox.x1;

  // optional high-contrast outline so a white wordmark reads on light and dark
  const wrap = (w) =>
    outline
      ? ` stroke="${outline}" stroke-width="${w}" stroke-linejoin="round" paint-order="stroke"`
      : "";

  return `
  <g fill="${color}">
    <path d="${wm.d}" transform="translate(${round(wmX)} ${round(base1)})"${wrap(5)}/>
    <path d="${tag.d}" transform="translate(${round(tagX)} ${round(tagBase)})"${wrap(2)}/>
  </g>`;
}

const round = (n) => Math.round(n * 100) / 100;

function wordmarkSvg(color, outline) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WM_W} ${WM_H}" fill="none">${wordmarkPaths(color, outline)}
</svg>
`;
}

/* ---------------------------------------------------------------- favicon */

function kPath(capH) {
  // "K" glyph scaled to capH, bbox-normalised so caller can centre it
  const size = capH / capRatio;
  const l = layout("K", size, 0);
  return l;
}

function faviconSvg(color = ORANGE, bg = INK, rounded = true) {
  const S = 64;
  const r = rounded ? 13 : 0;
  const k = kPath(40);
  const kw = k.bbox.x2 - k.bbox.x1;
  const kh = k.bbox.y2 - k.bbox.y1;
  const tx = (S - kw) / 2 - k.bbox.x1;
  const ty = (S - kh) / 2 - k.bbox.y1;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" fill="none">
  <rect width="${S}" height="${S}" rx="${r}" fill="${bg}"/>
  <path fill="${color}" d="${k.d}" transform="translate(${round(tx)} ${round(ty)})"/>
</svg>
`;
}

/* --------------------------------------------------------------- app icon */

/** Square app icon: orange field, white card, ring + KOURRO (800x800 box). */
function appIconSvg() {
  const S = 800;
  const card = 125;
  const wm = layout("KOURRO", 100, -0.015);
  const wmW = wm.bbox.x2 - wm.bbox.x1;
  const targetW = 400;
  const s = targetW / wmW;
  const cx = S / 2;
  const cy = S / 2;
  const tx = cx - s * ((wm.bbox.x1 + wm.bbox.x2) / 2);
  const ty = cy - s * ((wm.bbox.y1 + wm.bbox.y2) / 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" fill="none">
  <rect width="${S}" height="${S}" fill="${ORANGE}"/>
  <rect x="${card}" y="${card}" width="${S - card * 2}" height="${S - card * 2}" fill="#ffffff"/>
  <circle cx="${S / 2}" cy="${S / 2}" r="120" stroke="${ORANGE}" stroke-width="3"/>
  <path fill="${INK}" d="${wm.d}" transform="translate(${round(tx)} ${round(ty)}) scale(${round(s * 1000) / 1000})"/>
</svg>
`;
}

/* --------------------------------------------------------------- writing */

const DIRS = {
  admin: path.join(ROOT, "admin-portal/public"),
  site: path.join(ROOT, "sales-site/public"),
  mobile: path.join(ROOT, "mobile-app/assets"),
  web: path.join(ROOT, "web-app/public"),
  ios: path.join(ROOT, "ios/retailsalesmanagement/Images.xcassets/AppIcon.appiconset"),
  preview: path.join(os.tmpdir(), "kourro-brand"),
};

const writeFile = (p, data) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
};

async function raster(svg, { width, height, density = 72, format, out }) {
  const img = sharp(Buffer.from(svg), { density });
  if (width && height) await img.resize(width, height, { fit: "fill" });
  let b = img;
  if (format === "png") b = img.png({ compressionLevel: 9 });
  else if (format === "webp") b = img.webp({ quality: 92 });
  else if (format === "avif") b = img.avif({ quality: 60 });
  const buf = await b.toBuffer();
  writeFile(out, buf);
}

async function main() {
  const previewOnly = process.argv.includes("--preview");

  const logoOrange = wordmarkSvg(ORANGE);
  const logoWhite = wordmarkSvg(WHITE, INK);
  const logoDark = wordmarkSvg(INK);
  const fav = faviconSvg(ORANGE, INK, true);
  const favSquare = faviconSvg(ORANGE, INK, false);
  const icon = appIconSvg();

  for (const [name, svg] of Object.entries({ logoOrange, logoWhite, logoDark, fav, favSquare, icon })) {
    if (/NaN|undefined|Infinity/.test(svg)) throw new Error(`${name} has broken path data`);
  }

  if (previewOnly) {
    const p = (n) => path.join(DIRS.preview, n);
    await raster(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 489 128"><rect width="489" height="128" fill="#fff"/>${wordmarkPaths(ORANGE)}</svg>`, { density: 72 * 4, out: p("wordmark-light.png"), format: "png" });
    await raster(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 489 128"><rect width="489" height="128" fill="#0b0b0d"/>${wordmarkPaths(ORANGE)}</svg>`, { density: 72 * 4, out: p("wordmark-dark.png"), format: "png" });
    await raster(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 489 128"><rect width="489" height="128" fill="#0b0b0d"/>${wordmarkPaths(WHITE)}</svg>`, { density: 72 * 4, out: p("wordmark-white.png"), format: "png" });
    await raster(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 489 128"><rect width="489" height="128" fill="#f6f1e4"/>${wordmarkPaths(WHITE, INK)}</svg>`, { density: 72 * 4, out: p("wordmark-white-wrapped-light.png"), format: "png" });
    await raster(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 489 128"><rect width="489" height="128" fill="#f6f1e4"/>${wordmarkPaths(WHITE, INK)}</svg>`, { width: 489, height: 128, density: 72 * 4, out: p("wordmark-white-wrapped-light-1x.png"), format: "png" });
    await raster(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 489 128"><rect width="489" height="128" fill="#f6f1e4"/>${wordmarkPaths(WHITE, INK)}</svg>`, { width: 178, height: 46, density: 72 * 4, out: p("wordmark-white-wrapped-light-footer.png"), format: "png" });
    await raster(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 489 128"><rect width="489" height="128" fill="#0b0b0d"/>${wordmarkPaths(WHITE, INK)}</svg>`, { density: 72 * 4, out: p("wordmark-white-wrapped-dark.png"), format: "png" });
    await raster(fav, { density: 72 * 8, out: p("favicon.png"), format: "png" });
    await raster(icon, { density: 72, out: p("app-icon.png"), format: "png" });
    console.log("previews in", DIRS.preview);
    return;
  }

  // --- SVG wordmarks (both web roots)
  for (const dir of [DIRS.admin, DIRS.site]) {
    writeFile(path.join(dir, "logo.svg"), logoOrange);
    writeFile(path.join(dir, "logo-white.svg"), logoWhite);
    writeFile(path.join(dir, "logo-dark.svg"), logoDark);
    writeFile(path.join(dir, "favicon.svg"), fav);

    // wordmark rasters (1x = 489x128, 2x = 978x256)
    await raster(logoOrange, { density: 72, out: path.join(dir, "logo.png"), format: "png" });
    await raster(logoOrange, { density: 72, out: path.join(dir, "logo.webp"), format: "webp" });
    await raster(logoOrange, { density: 144, out: path.join(dir, "logo@2x.webp"), format: "webp" });
    await raster(logoOrange, { density: 72, out: path.join(dir, "logo.avif"), format: "avif" });
    await raster(logoOrange, { density: 144, out: path.join(dir, "logo@2x.avif"), format: "avif" });

    // favicons (rendered large, then downscaled)
    await raster(fav, { width: 64, height: 64, density: 72 * 16, out: path.join(dir, "favicon.png"), format: "png" });
    await raster(fav, { width: 32, height: 32, density: 72 * 16, out: path.join(dir, "favicon-32.png"), format: "png" });
    await raster(favSquare, { width: 180, height: 180, density: 72 * 16, out: path.join(dir, "apple-touch-icon.png"), format: "png" });
  }

  // --- app icons (render at 2x, downscale to target)
  await raster(icon, { density: 72 * 2, width: 800, height: 800, out: path.join(DIRS.mobile, "kourro-logo.png"), format: "png" });
  await raster(icon, { density: 72 * 2, width: 800, height: 800, out: path.join(DIRS.web, "kourro-logo.png"), format: "png" });
  await raster(icon, { density: 72 * 2, width: 1024, height: 1024, out: path.join(DIRS.ios, "App-Icon-1024x1024@1x.png"), format: "png" });

  // --- mobile wordmark
  await raster(logoOrange, { density: 72, out: path.join(DIRS.mobile, "kourro-wordmark.png"), format: "png" });

  console.log("brand assets written");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
