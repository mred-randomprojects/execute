// Generates macOS app icons from assets/icon.svg → build/icon.icns (+ icon.png).
// Run with: pnpm icons
import sharp from "sharp";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svgPath = join(root, "assets", "icon.svg");
const buildDir = join(root, "build");
const iconset = join(buildDir, "icon.iconset");

// Apple .iconset members: [pixel size, filename].
const MEMBERS = [
  [16, "icon_16x16.png"],
  [32, "icon_16x16@2x.png"],
  [32, "icon_32x32.png"],
  [64, "icon_32x32@2x.png"],
  [128, "icon_128x128.png"],
  [256, "icon_128x128@2x.png"],
  [256, "icon_256x256.png"],
  [512, "icon_256x256@2x.png"],
  [512, "icon_512x512.png"],
  [1024, "icon_512x512@2x.png"],
];

const svg = await readFile(svgPath);
// Rasterize the SVG once at high resolution, then downscale for crisp output.
const base = await sharp(svg, { density: 300 }).resize(1024, 1024).png().toBuffer();

await rm(iconset, { recursive: true, force: true });
await mkdir(iconset, { recursive: true });

for (const [size, name] of MEMBERS) {
  const png = await sharp(base).resize(size, size).png().toBuffer();
  await writeFile(join(iconset, name), png);
}

execFileSync("iconutil", ["-c", "icns", iconset, "-o", join(buildDir, "icon.icns")]);
await writeFile(join(buildDir, "icon.png"), base);
await rm(iconset, { recursive: true, force: true });

console.log("✓ build/icon.icns and build/icon.png generated");
