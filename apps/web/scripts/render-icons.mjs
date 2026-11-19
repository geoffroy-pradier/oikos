// Régénère les icônes PNG du manifeste à partir de `public/icon.svg` : `node scripts/render-icons.mjs`
// depuis `apps/web`. Le SVG fait foi ; les PNG en sont le rendu par Chromium (Playwright).
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

const svg = readFileSync(new URL('../public/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" `)}</body>`,
  );
  const path = fileURLToPath(new URL(`../public/icon-${size}.png`, import.meta.url));
  await page.screenshot({ path, omitBackground: true });
  console.log(path);
}
await browser.close();
