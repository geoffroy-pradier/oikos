import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { test } from '../../web/e2e/visual-browser';
import { enroll, expectNoHorizontalScroll, grantSuperAdmin, signIn } from './helpers';

/**
 * Contrôle visuel d'Olympe (#700, ADR 0011) : connexion, Vigie, Économie, Paramètres et Modération, dans les deux
 * thèmes, comparés à leur image de référence et contrôlés par axe. Vraie session à second facteur, vrai rôle ; les
 * lectures de l'API, qui portent sur tous les mondes et changent avec les autres suites, sont figées ici.
 */
const AT = '2026-11-02T08:15:00.000Z';
const id = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const WORLD = '01900000-0000-7000-8000-000000000001';
const DAYS = [20_753, 20_754, 20_755, 20_756, 20_757, 20_758, 20_759];

const vigie = {
  houses: 1_284,
  activeAccounts24h: 412,
  commands24h: { ok: 18_730, rejected: 214, failed: 3 },
  stewardOperations24h: { ok: 5_120, rejected: 41, failed: 0 },
  ticks24h: { failed: 0, maxDurationMs: 4_820 },
  voyagesOverdue: 0,
  staleReports: { afterHours: 24, count: 0, oldestHours: null },
  closes24h: { failed: 0, lastError: null },
  recentTicks: [0, 1, 2, 3, 4].map((back) => ({
    worldId: WORLD,
    worldSlug: 'archipel',
    tickIndex: 9_120 - back,
    status: back === 2 ? 'skipped' : 'done',
    durationMs: 3_900 + back * 137,
    error: null,
    createdAt: new Date(Date.parse(AT) - back * 3_600_000).toISOString(),
  })),
  queuePending: 7,
  refusals24h: { unauthenticated: 12, payloadTooLarge: 0, rateLimited: 4, forbidden: 1 },
  adminReads24h: 96,
  clock: { timezone: 'Europe/Paris', knownToDatabase: true, worlds: 1, invalidConfig: false },
  selfReviewAllowed: false,
  ai: (['oracle', 'chronicle', 'steward'] as const).map((usage, i) => ({
    usage,
    cut: i === 2 ? 'capped' : null,
    capMicroEuros: 20_000_000,
    spentTodayMicroEuros: 310_000 * (i + 1),
    spentMonthMicroEuros: 4_200_000 * (i + 1),
    answeredMonth: 1_830 - i * 400,
    rejectedMonth: 12 + i,
  })),
};

type Economy = { worlds: { slug: string; systemAccounts: { kind: string }[] }[] };
/** Le seul monde du jeu : d'autres suites en créent un second (`apps/web/e2e/city-fixtures.ts`). */
const game = (worlds: Economy['worlds']) => worlds.filter((world) => world.slug === 'archipel');
const economy = (real: Economy) => ({
  ...real,
  worlds: game(real.worlds).map((world) => ({
    ...world,
    moneySupply: {
      total: 18_604_200,
      houses: 12_310_400,
      escrow: 402_300,
      cityTreasuries: 3_920_500,
      npcPurses: 1_964_000,
      bankVaults: 0,
      other: 7_000,
    },
    // Montants positifs, créés (robinet) ou détruits (puits) : chaque robinet et un puits sur trois bougent.
    systemAccounts: world.systemAccounts.map((account, i) => {
      const scale = account.kind === 'faucet' ? 3 : 1;
      const days =
        i % (4 - scale) === 0
          ? DAYS.map((gameDay, d) => ({
              gameDay,
              amount: scale * (300 + ((i * 7 + d * 13) % 40) * 10),
            }))
          : [];
      return {
        ...account,
        total: days.reduce((sum, day) => sum + day.amount, scale * 20_000),
        days,
      };
    }),
    priceIndex: {
      currentBps: 10_184,
      previousBps: 10_052,
      inflationBps: 131,
      status: 'in_target',
      unpricedGoods: [],
      unpricedByWindow: { current: [], previous: [] },
      partialWindow: null,
    },
    // Fortunes (#718) : les maisons des autres suites changent d'un passage à l'autre ; mesures figées.
    inequality: {
      giniBps: 4_187,
      houses: 26,
      unpricedStocks: 3,
      cities: [
        { slug: 'kalliste', giniBps: 3_912, houses: 18, unpricedStocks: 3 },
        { slug: 'elaia', giniBps: 2_405, houses: 8, unpricedStocks: 0 },
        { slug: 'halos', giniBps: null, houses: 0, unpricedStocks: 0 },
      ].map((city, i) => ({ cityId: `01900000-0000-7000-8000-00000000071${i}`, ...city })),
    },
  })),
});

type Listing = {
  activeVersionId: string;
  versions: { id: string; number: number; createdAt: string }[];
  activations: { versionId: string; activateAt: string; createdAt: string }[];
};
/** Seule la version initiale, que d'autres suites ne changent pas, à une date fixe. */
const listing = (real: Listing) => {
  const initial = real.versions.filter((version) => version.number === 1);
  return {
    ...real,
    activeVersionId: initial[0]?.id,
    buybacks: [],
    // Ce que le monde porte encore d'une recette retirée dépend des autres suites (`first-slice.spec.ts`) : rien.
    versions: initial.map((version) => ({
      ...version,
      createdAt: AT,
      retiredInUse: { goods: [], recipes: [], npcClasses: [] },
      alreadyRetiredInUse: { recipes: [], npcClasses: [] },
    })),
    activations: real.activations
      .filter((activation) => activation.versionId === initial[0]?.id)
      .map((activation) => ({ ...activation, activateAt: AT, createdAt: AT })),
  };
};

const message = (n: number, houseName: string, body: string, minutes: number) => ({
  id: id(900 + n),
  houseId: id(800 + n),
  houseName,
  body,
  createdAt: new Date(Date.parse(AT) - minutes * 60_000).toISOString(),
  hiddenAt: null,
});
const reports = (real: object) => ({
  ...real,
  now: AT,
  queue: [
    {
      world: 'archipel',
      reportedHouse: { id: id(802), name: 'Alcméonides', userId: id(702) },
      channel: { id: id(600), kind: 'city', city: 'kalliste' },
      message: message(2, 'Alcméonides', 'Vos amphores fuient, et votre parole aussi.', 95),
      reports: [
        {
          id: id(500),
          reason: 'harassment',
          createdAt: new Date(Date.parse(AT) - 80 * 60_000).toISOString(),
        },
        {
          id: id(501),
          reason: 'spam',
          createdAt: new Date(Date.parse(AT) - 30 * 60_000).toISOString(),
        },
      ],
      context: [
        message(1, 'Philaïdes', 'Qui vend du sel au port ce soir ?', 97),
        message(3, 'Philaïdes', 'Restons courtois sur le canal de la cité.', 90),
      ],
    },
  ],
});

/** Lectures de l'API figées : la vraie réponse, ses parties changeantes remplacées. */
async function freeze(page: Page) {
  const fix = (path: string, body: (real: never) => unknown) =>
    page.route(`**/api/admin/${path}`, async (route) => {
      const response = await route.fetch();
      const real = (await response.json()) as { data: never };
      await route.fulfill({ response, json: { ok: true, data: body(real.data) } });
    });
  await fix('vigie', () => vigie);
  await fix('economy', economy);
  await fix('config/versions', listing);
  await fix('reports', reports);
}

async function seriousViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => ({
      rule: violation.id,
      targets: violation.nodes.map((node) => node.target.join(' ')),
    }));
}

/**
 * Compare l'écran à sa référence dans chaque thème, choisi au clavier par le bouton d'Olympe, puis le contrôle par
 * axe. Page entière : la fenêtre est portée à la hauteur du contenu, le pointeur posé dans la marge (aucun survol).
 */
async function capture(page: Page, screen: string) {
  const viewport = page.viewportSize() ?? { width: 0, height: 0 };
  const dark = page.getByRole('button', { name: 'Thème sombre' });
  for (const [suffix, pressed] of [
    ['clair', 'false'],
    ['sombre', 'true'],
  ] as const) {
    if ((await dark.getAttribute('aria-pressed')) !== pressed) await dark.press('Enter');
    await expect(dark).toHaveAttribute('aria-pressed', pressed);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.evaluate(() => document.fonts.ready);
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({
      width: viewport.width,
      height: Math.max(viewport.height, height),
    });
    await page.mouse.move(0, Math.round(viewport.height / 2));
    await expect.soft(page).toHaveScreenshot(`${screen}-${suffix}.png`);
    await page.setViewportSize(viewport);
    expect.soft(await seriousViolations(page), `${screen}, thème ${suffix}`).toEqual([]);
  }
  await expectNoHorizontalScroll(page);
}

// Navigateur de l'image Docker de Playwright, le même que pour le jeu (`apps/web/e2e/visual-browser.ts`), heure de
// Paris. Dix captures, dont un enrôlement à second facteur : plus que le délai par défaut.
test.use({ timezoneId: 'Europe/Paris' });
test.setTimeout(180_000);

test('Olympe : références visuelles et axe, thèmes clair et sombre', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await freeze(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Connexion à Olympe' })).toBeVisible();
  await capture(page, 'connexion');

  const email = `olympe-visuel-${info.project.name}-${Date.now()}@example.test`;
  await signIn(page, email);
  await grantSuperAdmin(email);
  await enroll(page);
  const modules = page.getByRole('navigation', { name: 'Modules' });
  // Chaque module attend sa donnée figée avant la capture.
  for (const [name, screen, ready] of [
    ['Vigie', 'vigie', 'Maisons fondées'],
    ['Économie', 'economie', 'Monde « archipel »'],
    ['Paramètres', 'parametres', 'Version 1'],
    ['Modération', 'moderation', 'Vos amphores fuient, et votre parole aussi.'],
  ] as const) {
    await modules.getByRole('button', { name }).click();
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
    await expect(page.getByText(ready).first()).toBeVisible();
    await capture(page, screen);
  }
});
