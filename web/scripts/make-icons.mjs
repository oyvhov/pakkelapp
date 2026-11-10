// Lagar PNG-ikon for jul og resten av året frå favicon.svg og favicon-fest.svg.
// Køyr manuelt: node scripts/make-icons.mjs
import sharp from 'sharp';
import { readFileSync } from 'node:fs';

for (const [suffix, bg] of [['', '#17372f'], ['-fest', '#2f2b5a']]) {
  const svg = readFileSync(`public/favicon${suffix}.svg`);
  const square = Buffer.from(svg.toString().replace('rx="14"', 'rx="0"'));
  await sharp(svg, { density: 900 }).resize(192).png().toFile(`public/icon-192${suffix}.png`);
  await sharp(svg, { density: 900 }).resize(512).png().toFile(`public/icon-512${suffix}.png`);
  await sharp(square, { density: 900 }).resize(180).png().toFile(`public/apple-touch-icon${suffix}.png`);
  const inner = await sharp(square, { density: 900 }).resize(380).png().toBuffer();
  await sharp({ create: { width: 512, height: 512, channels: 4, background: bg } })
    .composite([{ input: inner, gravity: 'center' }])
    .png()
    .toFile(`public/icon-maskable-512${suffix}.png`);
}
