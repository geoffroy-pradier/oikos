import { createDb } from '@oikos/db';
import { expect, type Locator, type Page, type Route } from '@playwright/test';
import { sql } from 'kysely';
import {
  citySection,
  expectNoHorizontalScroll,
  fillOrder,
  foundHouseForm,
  placeOrder,
  seriousViolations,
  signIn,
} from './helpers';
import { test } from './visual-browser';

/**
 * Contrôle visuel de la refonte (#700, ADR 0011) : chaque écran clé, dans les deux thèmes, comparé à son image de
 * référence (`visual.spec.ts-snapshots/`) et contrôlé par axe. Données figées : une maison par format, au nom fixe,
 * seule dans une cité qu'aucune autre suite n'emploie ; ce que l'horloge fait varier (heure, dates, durées) est
 * masqué. La mise en place se rejoue sans rien doubler : un nouvel essai retrouve la maison et la reprend.
 * Les images de référence se produisent comme la `ci` les compare : voir docs/specs/10-ux-ui.md, Contrôle visuel.
 */
const FORMATS = {
  'mobile-360': { name: 'Kodrides', city: '01900000-0000-7000-8000-000000000121' },
  'desktop-1440': { name: 'Philaides', city: '01900000-0000-7000-8000-000000000122' },
} as const;
const SCHEMES = { clair: 'light', sombre: 'dark' } as const;
const GREETING = 'Salut à la cité, du port à l’agora.';

/** Heure, date ou durée en cours : le texte change d'un passage à l'autre. */
const CLOCK =
  /\d{1,2}:\d{2}|\d{2}\/\d{2}\/\d{4}|\d+ h \d{2}|\b\d{1,2}(er)? (janv|févr|mars|avr|mai|juin|juil|août|sept|oct|nov|déc)/;

/**
 * Fige ce que l'horloge fait varier avant de le masquer : chaque nombre devient des zéros (au moins deux, chiffres
 * tabulaires, « 1er » compris), chaque mois « nov ». Le masque et ce qui suit sur la ligne gardent la même place d'un jour à l'autre.
 */
async function freezeClock(page: Page) {
  await page.evaluate((source) => {
    const clock = new RegExp(source, 'g');
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue ?? '';
      const frozen = text.replace(clock, (found) =>
        found
          .replace(/(\d+)(er)?/g, (_, digits: string) => '0'.repeat(Math.max(2, digits.length)))
          .replace(/[a-zéû]{3,4}$/, 'nov'),
      );
      if (frozen !== text) node.nodeValue = frozen;
    }
  }, CLOCK.source);
}

// Navigateur de l'image Docker de Playwright (`visual-browser.ts`), heure de Paris.
test.use({ timezoneId: 'Europe/Paris' });
test.setTimeout(180_000);

/** Abonnements en direct acceptés sans pile Realtime : l'écran est le même en local et en `ci`. */
async function acceptRealtime(page: Page) {
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, (socket) => {
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as unknown;
      const ok = { status: 'ok', response: {} };
      if (Array.isArray(message)) {
        const [joinRef, ref, topic] = message as [unknown, unknown, unknown];
        socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', ok]));
      } else {
        const { topic, ref, join_ref } = message as Record<string, unknown>;
        socket.send(JSON.stringify({ topic, event: 'phx_reply', payload: ok, ref, join_ref }));
      }
    });
  });
}

/**
 * Lectures de la cité figées. D'autres suites jouent, sur tout le monde, des étapes du moteur : le parc de logements
 * (`property-staff.spec.ts`, comme le premier tick) et la population des PNJ (`first-slice.spec.ts`) ; selon l'ordre
 * des suites, l'écran les verrait ou non. Ici, quatre biens dont trois à vendre, et une population par classe.
 */
async function freezeCity(page: Page, cityId: string) {
  const lots = [
    ['townhouse', 1, true, 10_000],
    ['townhouse', 2, true, 8_200],
    ['townhouse', 3, false, 9_500],
    ['tenement', 1, true, 9_000],
  ] as const;
  const park = lots.map(([size_id, lot, for_sale, condition], i) => ({
    id: `01900000-0000-7000-8000-0000000c000${i}`,
    city_id: cityId,
    size_id,
    lot,
    for_sale,
    condition,
  }));
  const people = [
    ['thetes', 4_210, 9_100],
    ['zeugitai', 1_830, 7_650],
    ['hippeis', 412, 10_000],
    ['pentakosiomedimnoi', 88, null],
  ].map(([class_id, population, coverage_bps]) => ({ class_id, population, coverage_bps }));
  const reply = (view: string, json: unknown) =>
    page.route(new RegExp(`/rest/v1/${view}\\?`), (route) => route.fulfill({ json }));
  await reply('city_properties', park);
  await reply('property_offers_upkeep', []);
  await reply('city_population', people);
}

/**
 * Finances de la maison (#732), lues figées : le temple prête (plafond de 2 000 drachmes), la trésorerie est de 5 000
 * drachmes, la Timè nulle, et la maison doit ou non un prêt selon `debt`. La base de l'essai n'a ni prêt ni temple
 * ouvert : l'écran serait vide. Rend la fonction qui retire ces lectures figées.
 */
async function freezeFinances(page: Page, debt: boolean) {
  const loan = {
    id: '01900000-0000-7000-8000-0000000f0030',
    lender: 'temple',
    principal: 6000,
    rate_bps: 1000,
    term_days: 28,
    interest: 46,
    due_day: 99_999,
    due_at: '2999-01-01T04:00:00+00:00',
    principal_repaid: 0,
    interest_repaid: 0,
    outstanding: 6046,
    status: 'active',
  };
  const views: [string, unknown][] = [
    ['my_loans', debt ? [loan] : []],
    ['house_honor', [{ honor: 0, dishonored: false, dishonored_until_day: null }]],
    [
      'temple_treasury_rules',
      [
        {
          policy_rate_bps: 1000,
          term_days: [7, 14, 28],
          principal_caps: [{ minHonor: 0, maxPrincipal: 12_000 }],
        },
      ],
    ],
    ['my_balance_sheet', [{ treasury: 30_000, escrow: 0, stock_value: 0, unpriced_stocks: 0 }]],
  ];
  const routes = views.map(([view, json]) => {
    const url = new RegExp(`/rest/v1/${view}\\?`);
    const handler = (route: Route) => route.fulfill({ json });
    return { url, handler };
  });
  for (const { url, handler } of routes) await page.route(url, handler);
  return async () => {
    for (const { url, handler } of routes) await page.unroute(url, handler);
  };
}

/**
 * Liturgies et ostracisme de la cité (#723), lus figés : quatre maisons désignées (la maison de l'essai, à accomplir, et
 * trois autres, qui n'existent pas en base), un vote d'ostracisme au vote ou dépouillé. Les lectures des maisons
 * (`houses`) rendent, en plus des vraies, ces maisons fictives, filtrées comme le fait la base.
 */
const FICTIVE = [
  ['01900000-0000-7000-8000-0000000f0001', 'Alcméonides', 'performed', 'festival'],
  ['01900000-0000-7000-8000-0000000f0002', 'Étéoboutades', 'levied', 'trierarchy'],
  ['01900000-0000-7000-8000-0000000f0003', 'Philaïdes', 'assigned', 'choregia'],
] as const;
async function freezeCivics(
  page: Page,
  {
    cityId,
    houseId,
    ostracism,
  }: { cityId: string; houseId: string; ostracism: 'voting' | 'tallied' },
) {
  const reply = (view: string, json: unknown) =>
    page.route(new RegExp(`/rest/v1/${view}\\?`), (route) => route.fulfill({ json }));
  const dueAt = '2999-01-01T04:00:00+00:00';
  await reply('my_liturgies', [
    {
      id: '01900000-0000-7000-8000-0000000f0010',
      city_id: cityId,
      season: 9001,
      genre: 'festival',
      due: 1260,
      due_at: dueAt,
      status: 'assigned',
    },
  ]);
  await reply('liturgy_rules', [
    { rules: { honorGain: 40, charisGain: 25, evasionHonorLoss: 90, maxSplendorBps: 10_000 } },
  ]);
  await reply('city_liturgies', [
    { house_id: houseId, season: 9001, genre: 'festival', status: 'assigned', due_at: dueAt },
    ...FICTIVE.map(([house_id, , status, genre]) => ({
      house_id,
      season: 9001,
      genre,
      status,
      due_at: dueAt,
    })),
  ]);
  const vote = {
    id: '01900000-0000-7000-8000-0000000f0020',
    city_id: cityId,
    opened_at: '2999-01-01T04:00:00+00:00',
    voting_closes_at:
      ostracism === 'voting' ? '2999-01-04T04:00:00+00:00' : '2020-01-04T04:00:00+00:00',
    quorum_bps: 2000,
    tallied_at: ostracism === 'voting' ? null : '2020-01-04T05:00:00+00:00',
    electorate: ostracism === 'voting' ? null : 4,
    ballots: ostracism === 'voting' ? null : 3,
    outcome: ostracism === 'voting' ? null : 'ostracized',
    ostracized_house_id: ostracism === 'voting' ? null : FICTIVE[1][0],
    ends_at: ostracism === 'voting' ? null : '2999-02-01T04:00:00+00:00',
    in_force: ostracism === 'tallied',
  };
  await reply('ostracisms', [vote]);
  await reply('my_ostraca', []);
  await reply('ostracism_results', [
    { ostracism_id: vote.id, house_id: FICTIVE[1][0], ostraca: 2 },
    { ostracism_id: vote.id, house_id: FICTIVE[0][0], ostraca: 1 },
  ]);
  await page.route(/\/rest\/v1\/houses\?/, async (route) => {
    const url = route.request().url();
    const real = (await (await route.fetch()).json()) as { id: string }[];
    // La lecture de la maison du joueur par la coquille (`is_mine`) reste celle de la base.
    if (url.includes('is_mine')) return route.fulfill({ json: real });
    const ids = /[?&]id=in\.\(([^)]*)\)/.exec(url)?.[1]?.split(',').map(decodeURIComponent);
    const fictive = FICTIVE.map(([id, name]) => ({
      id,
      name,
      blazon: null,
      created_at: '2026-11-01T00:00:00+00:00',
      city_id: cityId,
      citizenship_status: 'citizen',
      is_mine: false,
    })).filter((row) => !ids || ids.includes(row.id));
    // Maison de l'essai citoyenne : elle peut voter.
    const own = real.map((row) =>
      row.id === houseId ? { ...row, citizenship_status: 'citizen' } : row,
    );
    await route.fulfill({ json: [...own, ...fictive] });
  });
}

/**
 * Compare l'écran à sa référence dans chaque thème, puis le contrôle par axe. Page entière : la fenêtre est portée à
 * la hauteur du contenu (la barre d'onglets reste en bas), le pointeur posé dans la marge (aucun survol).
 * `reload` : hors de la coquille, le thème de l'appareil n'est lu qu'au chargement. `target` : une partie seule.
 */
async function capture(
  page: Page,
  screen: string,
  { reload = false, target }: { reload?: boolean; target?: Locator } = {},
) {
  const viewport = page.viewportSize() ?? { width: 0, height: 0 };
  for (const [suffix, scheme] of Object.entries(SCHEMES)) {
    await page.emulateMedia({ colorScheme: scheme });
    if (reload) await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    await page.evaluate(() => document.fonts.ready);
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({
      width: viewport.width,
      height: Math.max(viewport.height, height),
    });
    await page.mouse.move(0, Math.round(viewport.height / 2));
    await freezeClock(page);
    await expect
      .soft(target ?? page)
      .toHaveScreenshot(`${screen}-${suffix}.png`, { mask: [page.getByText(CLOCK)] });
    await page.setViewportSize(viewport);
    expect.soft(await seriousViolations(page), `${screen}, thème ${suffix}`).toEqual([]);
  }
  await expectNoHorizontalScroll(page);
}

/**
 * Ouvre un écran par son adresse et attend son titre, sans foyer resté sur le titre. Sous l'onglet Maison, la
 * pastille de l'écran est visible en entier, même quand la gélule défile (téléphone).
 */
async function open(page: Page, path: string, title: string | RegExp) {
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const here = page
    .getByRole('navigation', { name: 'Rubriques de la maison' })
    .locator('[aria-current="page"]');
  if ((await here.count()) > 0) await expect(here).toBeInViewport({ ratio: 1 });
}

/** Hors `ci`, une base gardée depuis la veille fait vieillir la maison : la comparaison n'a plus de sens. */
async function foundedLongAgo(name: string) {
  const db = createDb(process.env['DATABASE_URL'] ?? '');
  try {
    const { rows } = await sql<{
      old: boolean;
    }>`select created_at < now() - interval '1 hour' as old
      from game.houses where name = ${name}`.execute(db);
    return rows[0]?.old === true;
  } finally {
    await db.destroy();
  }
}

test('écrans clés du jeu : références visuelles et axe, thèmes clair et sombre', async ({
  page,
}, info) => {
  const format = FORMATS[info.project.name as keyof typeof FORMATS];
  test.skip(
    !process.env['CI'] && (await foundedLongAgo(format.name)),
    'Base locale gardée depuis plus d’une heure : réinitialiser la base avant le contrôle visuel.',
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await acceptRealtime(page);
  await freezeCity(page, format.city);

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await capture(page, 'connexion', { reload: true });

  // Mise en place, reprise telle quelle par un nouvel essai : la maison, un achat en attente, un message.
  await signIn(page, `visuel-${info.project.name}@example.test`);
  const hello = page.getByRole('heading', { name: `Bonjour, Maison ${format.name}` });
  const nameField = page.getByLabel('Nom de la maison');
  await expect(hello.or(nameField)).toBeVisible();
  if (await nameField.isVisible())
    await foundHouseForm(page, format.name, page.locator(`input[value="${format.city}"]`));
  await expect(hello).toBeVisible();

  await open(page, '/agora', /^Agora de /);
  if (await page.getByText('Aucun ordre en attente.').isVisible()) {
    await fillOrder(page, 'Acheter', 20, 4);
    await page.keyboard.press('Enter');
    await placeOrder(page);
    await expect(page.getByRole('status').filter({ hasText: 'Achat en attente' })).toBeVisible();
  }
  // Sur téléphone, la liste des canaux vient d'abord : on ouvre celui de la cité.
  const thread = page.getByRole('list', { name: 'Messages du canal' });
  const openThread = async () => {
    await open(page, '/messages', 'Messages');
    const channel = page.getByRole('button', { name: /^Canal de / });
    if (await channel.isVisible()) await channel.click();
    await expect(thread.or(page.getByText("Aucun message pour l'instant."))).toBeVisible();
  };
  await openThread();
  if (!(await thread.getByText(GREETING).isVisible())) {
    await page.getByRole('textbox', { name: /^Votre message dans/ }).fill(GREETING);
    await page.getByRole('button', { name: 'Envoyer' }).click();
    await expect(thread.getByText(GREETING)).toBeVisible();
    await openThread();
  }
  await capture(page, 'messages');

  await open(page, '/', `Bonjour, Maison ${format.name}`);
  await capture(page, 'maison');
  await open(page, '/sites', 'Sites');
  await capture(page, 'sites');
  await open(page, '/personnel', 'Personnel');
  await capture(page, 'personnel');
  await open(page, '/immobilier', 'Immobilier');
  await capture(page, 'immobilier');
  await open(page, '/comptes', `Comptes de la maison ${format.name}`);
  await capture(page, 'comptes');
  // Finances (#732), lectures figées : une dette du temple et sa feuille de remboursement, puis l'emprunt possible.
  let unfreeze = await freezeFinances(page, true);
  await open(page, '/finances', 'Finances');
  await capture(page, 'finances');
  await page.getByRole('button', { name: /^Rembourser\s:\sTrésor du temple$/ }).click();
  const repay = page.getByRole('dialog', { name: 'Rembourser un prêt' });
  await repay.getByLabel(/^Montant remboursé/).fill('300');
  await repay.getByRole('button', { name: 'Continuer' }).click();
  await capture(page, 'finances-remboursement', { target: repay });
  await page.keyboard.press('Escape');
  await unfreeze();
  unfreeze = await freezeFinances(page, false);
  await open(page, '/finances', 'Finances');
  await capture(page, 'finances-emprunt');
  await page.getByRole('button', { name: 'Emprunter', exact: true }).click();
  const borrow = page.getByRole('dialog', { name: 'Emprunter au Trésor du temple' });
  await borrow.getByLabel(/^Montant emprunté/).fill('6000');
  await borrow.getByRole('button', { name: 'Continuer' }).click();
  await borrow.getByRole('radio', { name: '28 jours' }).check();
  await capture(page, 'finances-emprunt-feuille', { target: borrow });
  await page.keyboard.press('Escape');
  await unfreeze();
  await open(page, '/carte', "Carte de l'archipel");
  await capture(page, 'carte');
  await open(page, '/cite', /^Cité de /);
  await capture(page, 'cite');
  await open(page, '/cite/temple', /^Temple de /);
  await capture(page, 'temple');

  await open(page, '/agora', /^Agora de /);
  await capture(page, 'agora');
  // La feuille d'ordre, saisie faite : quantité, prix, et la borne connue.
  await fillOrder(page, 'Acheter', 12, 5);
  // La feuille seule : l'en-tête de la page, sous le voile, porte l'heure.
  await capture(page, 'agora-feuille', { target: page.getByRole('dialog') });

  // Liturgies et ostracisme (#723), lectures figées : l'onglet Cité, l'écran de la liturgie et ses feuilles.
  const db = createDb(process.env['DATABASE_URL'] ?? '');
  const { rows } = await sql<{ id: string }>`select id from game.houses where name = ${format.name}`
    .execute(db)
    .finally(() => void db.destroy());
  const houseId = rows[0]?.id ?? '';
  await freezeCivics(page, { cityId: format.city, houseId, ostracism: 'voting' });
  await open(page, '/cite', /^Cité de /);
  await citySection(page, 'Liturgies');
  await capture(page, 'cite-liturgies');
  await citySection(page, 'Ostracisme');
  await capture(page, 'cite-ostracisme');
  await page.getByRole('button', { name: 'Inscrire un nom' }).click();
  await page.getByRole('dialog').getByLabel('Rechercher un citoyen').fill('é');
  await capture(page, 'cite-ostracisme-feuille', { target: page.getByRole('dialog') });
  await page.keyboard.press('Escape');
  await open(page, '/', `Bonjour, Maison ${format.name}`);
  await capture(page, 'maison-liturgie');
  await open(page, '/cite/liturgie', 'Liturgie');
  await capture(page, 'liturgie');
  await page.getByRole('button', { name: 'Accomplir ma liturgie' }).click();
  const sheet = page.getByRole('dialog', { name: 'Accomplir ma liturgie' });
  await sheet.getByRole('button', { name: 'Continuer' }).click();
  await sheet.getByLabel(/^Faste/).fill('420');
  await capture(page, 'liturgie-feuille', { target: sheet });
  await page.keyboard.press('Escape');
  // Même onglet, vote dépouillé : l'ostracisé, les bulletins et le décompte.
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await freezeCity(page, format.city);
  await freezeCivics(page, { cityId: format.city, houseId, ostracism: 'tallied' });
  await open(page, '/cite', /^Cité de /);
  await citySection(page, 'Ostracisme');
  await capture(page, 'cite-ostracisme-resultat');
});
