import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, foundHouseForm, signIn } from './helpers';

// Tableaux larges lisibles (#865) : à 1 440 px, le compte de résultat tient sans coupure, et ses en-têtes
// restent sur deux lignes au plus ; en dessous de 1 024 px, les mêmes lignes sont des fiches.
test('compte de résultat : toutes ses colonnes tiennent à 1 440 px, en-têtes sur deux lignes', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop-1440', 'tableau à partir de 1 024 px');
  const id = randomUUID();
  await signIn(page, `e2e-${id}@example.test`);
  const name = `Tableaux ${[...id.replace(/[^a-f]/g, '')].slice(0, 6).join('')}`;
  await foundHouseForm(page, name);
  await expect(page.getByRole('heading', { name: `Maison ${name}` })).toBeVisible();
  await page.goto('/comptes');
  const table = page.getByRole('table', { name: 'Compte de résultat' });
  await expect(table.getByRole('rowheader')).toHaveCount(1);

  await table.scrollIntoViewIfNeeded();

  // Dernière colonne entière dans la fenêtre, et rien à faire défiler : le cadre ne déborde pas.
  await expect(table.getByRole('columnheader', { name: 'dont séquestre' })).toBeInViewport({
    ratio: 1,
  });
  await expect(table.locator('xpath=..')).toHaveJSProperty('scrollLeft', 0);
  const overflow = await table.evaluate((node) => {
    const frame = node.parentElement as HTMLElement;
    return frame.scrollWidth - frame.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
  await expectNoHorizontalScroll(page);

  // Chaque en-tête : deux lignes de texte au plus (lignes distinctes des rectangles de son texte).
  const lines = await table.getByRole('columnheader').evaluateAll((cells) =>
    cells.map((cell) => {
      const tops = new Set<number>();
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        // La flèche de tri est décorative : elle n'est pas une ligne de texte.
        if (node.parentElement?.closest('[aria-hidden="true"]')) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const box of range.getClientRects()) if (box.width > 0) tops.add(Math.round(box.top));
      }
      return tops.size;
    }),
  );
  const names = await table.getByRole('columnheader').allInnerTexts();
  const tooLong = lines.flatMap((count, index) => (count > 2 ? [names[index]] : []));
  expect(tooLong).toEqual([]);
});
