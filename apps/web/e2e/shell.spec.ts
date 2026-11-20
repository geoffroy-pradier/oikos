import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, foundHouseForm, seriousViolations, signIn } from './helpers';

test('coquille : sans violation grave (axe) dans les deux thèmes, Réglages au clavier', async ({
  page,
}) => {
  // Animations coupées : axe lit les couleurs finales, et la coquille doit tenir sans mouvement.
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  const id = randomUUID();
  const houseName = `Coquille ${[...id.replace(/[^a-f]/g, '')].slice(0, 8).join('')}`;
  await signIn(page, `e2e-${id}@example.test`);
  await foundHouseForm(page, houseName);
  await expect(page.getByRole('heading', { name: `Maison ${houseName}` })).toBeVisible();

  // Sur ordinateur, la maison est dans la barre latérale ; sur téléphone, dans l'en-tête compact.
  const wide = (page.viewportSize()?.width ?? 0) >= 1024;
  const nav = page.getByRole('navigation', { name: 'Navigation principale' });
  const where = wide ? nav : page.getByRole('banner');
  await expect(where.getByText(`Maison ${houseName}`)).toBeVisible();
  await expect(page.getByRole('banner')).toHaveCount(wide ? 0 : 1);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await seriousViolations(page)).toEqual([]);
  await expectNoHorizontalScroll(page);

  // Réglages au clavier : la feuille prend le foyer, Échap la referme et le rend au bouton.
  const settings = page.getByRole('button', { name: 'Réglages' });
  await settings.focus();
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog', { name: 'Réglages' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Fermer' })).toBeFocused();
  await expect(sheet.getByRole('radio', { name: 'Appareil' })).toBeChecked();
  expect(await seriousViolations(page)).toEqual([]);
  await expectNoHorizontalScroll(page);

  // Thème sombre au clavier : flèche vers la gauche depuis « Appareil ».
  await sheet.getByRole('radio', { name: 'Appareil' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(sheet.getByRole('radio', { name: 'Sombre' })).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await seriousViolations(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(settings).toBeFocused();
  expect(await seriousViolations(page)).toEqual([]);

  // Thème de l'appareil : suivi en direct, et rien de mémorisé au rechargement.
  await settings.click();
  await sheet.getByRole('radio', { name: 'Appareil' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.getByRole('heading', { name: `Maison ${houseName}` })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('oikos.theme'))).toBeNull();
});

test('rangées de pastilles qui défilent : chaque onglet atteint au clavier est visible en entier', async ({
  page,
}) => {
  const id = randomUUID();
  const houseName = `Rangée ${[...id.replace(/[^a-f]/g, '')].slice(0, 8).join('')}`;
  await signIn(page, `e2e-${id}@example.test`);
  await foundHouseForm(page, houseName);
  await expect(page.getByRole('heading', { name: `Maison ${houseName}` })).toBeVisible();

  // Rubriques de la maison : la pastille de l'écran est entière à l'arrivée, puis chaque lien au clavier.
  await page.goto('/comptes');
  const sections = page.getByRole('navigation', { name: 'Rubriques de la maison' });
  await expect(sections.locator('[aria-current="page"]')).toBeInViewport({ ratio: 1 });
  const links = sections.getByRole('link');
  await links.first().focus();
  for (let index = 0; index < (await links.count()); index += 1) {
    if (index > 0) await page.keyboard.press('Tab');
    await expect(links.nth(index)).toBeFocused();
    await expect(links.nth(index)).toBeInViewport({ ratio: 1 });
  }
  await expectNoHorizontalScroll(page);

  // Onglet Cité : les pastilles sous l'en-tête, chacune atteinte par les flèches.
  await page.goto('/cite');
  const tabs = page.getByRole('tablist', { name: 'Rubriques de la cité' }).getByRole('tab');
  await expect(tabs.first()).toBeInViewport({ ratio: 1 });
  await tabs.first().focus();
  for (let index = 0; index < (await tabs.count()); index += 1) {
    if (index > 0) await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(index)).toBeFocused();
    await expect(tabs.nth(index)).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.nth(index)).toBeInViewport({ ratio: 1 });
  }
  await expectNoHorizontalScroll(page);
});

test('cartes de chiffres : un montant long tient sur une ligne, dans sa carte, sans rapetisser sous ses voisines (#863)', async ({
  page,
}) => {
  // 486 drachmes 4 oboles (2 920 oboles) : la trésorerie lue est remplacée, sur la Maison comme sur Sites.
  await page.route('**/rest/v1/my_treasury*', (route) =>
    route.fulfill({ json: [{ balance: 2920 }] }),
  );
  const id = randomUUID();
  await signIn(page, `e2e-${id}@example.test`);
  const houseName = `Chiffres ${[...id.replace(/[^a-f]/g, '')].slice(0, 8).join('')}`;
  await foundHouseForm(page, houseName);
  await expect(page.getByRole('heading', { name: `Maison ${houseName}` })).toBeVisible();
  for (const [path, title] of [
    ['/', /^Bonjour, Maison /],
    ['/sites', 'Sites'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    const values = page.locator('[data-stat-value]');
    await expect(values.getByText('486 drachmes 4 oboles', { exact: true })).toBeVisible();
    await expect(values.filter({ hasText: '—' })).toHaveCount(0);
    const boxes = await values.evaluateAll((elements) =>
      elements.map((element) => {
        // La valeur est dans son conteneur, sans marge intérieure, lui-même dans la carte.
        const card = element.parentElement?.getBoundingClientRect();
        const inset = parseFloat(getComputedStyle(element.parentElement as Element).paddingRight);
        const box = element.getBoundingClientRect();
        return {
          value: element.textContent,
          row: Math.round(element.parentElement?.parentElement?.getBoundingClientRect().top ?? 0),
          size: parseFloat(getComputedStyle(element).fontSize),
          lines: Math.round(box.height / parseFloat(getComputedStyle(element).lineHeight)),
          overflow: element.scrollWidth - element.clientWidth,
          outside: Math.ceil(box.right - ((card?.right ?? 0) - inset)),
        };
      }),
    );
    for (const box of boxes) {
      expect(box, `${path} : ${box.value}`).toMatchObject({ lines: 1, overflow: 0 });
      expect(box.outside, `${path} : ${box.value}`).toBeLessThanOrEqual(0);
      // Dans une rangée, aucune valeur, la trésorerie la première, n'est plus petite que ses voisines.
      const row = boxes.filter((other) => other.row === box.row);
      expect(row.length, `${path} : ${box.value}`).toBeGreaterThan(0);
      expect(box.size, `${path} : ${box.value}`).toBe(Math.max(...row.map((other) => other.size)));
    }
  }
  await expectNoHorizontalScroll(page);
});
