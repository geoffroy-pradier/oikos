import type { ChronicleFacts } from '@oikos/sim';
import en from './locales/en.json' with { type: 'json' };
import fr from './locales/fr.json' with { type: 'json' };

/**
 * Chronique de repli (règle 6, 8.4 ; #271) : composée par les gabarits `fr` et `en` à partir des seuls faits du
 * jour. C'est elle que lit un joueur quand l'IA est coupée ou que sa réécriture est rejetée ; elle est aussi le
 * brouillon que l'IA réécrit. Chaque nombre qu'elle écrit est un nombre des faits (`chronicleNumbers`).
 */
export const CHRONICLE_LOCALES = ['fr', 'en'] as const;
export type ChronicleLocale = (typeof CHRONICLE_LOCALES)[number];
export type ChronicleTexts = Record<ChronicleLocale, string>;

type Template = string | { [key: string]: Template };
const TEMPLATES: Record<ChronicleLocale, Template> = { fr, en };

export interface ChronicleContext {
  /** Identifiant court de la cité dont c'est la chronique. */
  citySlug: string;
  /** Nom en base de chaque cité du monde, par identifiant court : repli d'une cité sans traduction. */
  cityNames: ReadonlyMap<string, string>;
}

/** Vrai si la journée n'a rien à raconter hors population : la chronique le dit en une phrase. */
export function isQuietDay(facts: ChronicleFacts): boolean {
  const lists = [
    facts.goods,
    facts.arrivals,
    facts.losses,
    facts.elections,
    facts.decrees,
    facts.worldEvents,
  ];
  return lists.every((list) => list.length === 0) && facts.otherGoods === 0 && !facts.configChange;
}

function lookup(locale: ChronicleLocale, key: string): string | undefined {
  let node: Template | undefined = TEMPLATES[locale];
  for (const part of key.split('.'))
    node = typeof node === 'object' && Object.hasOwn(node, part) ? node[part] : undefined;
  return typeof node === 'string' ? node : undefined;
}

/** Un gabarit, ses variables remplacées ; avec `count`, sa forme plurielle (`_one`, `_other`). */
function render(
  locale: ChronicleLocale,
  key: string,
  vars: Record<string, string> = {},
  count?: number,
): string {
  const number = new Intl.NumberFormat(locale);
  const plural = count === undefined ? '' : `_${new Intl.PluralRules(locale).select(count)}`;
  const template = lookup(locale, key + plural) ?? lookup(locale, `${key}_other`);
  if (template === undefined) throw new Error(`Missing chronicle template ${locale}:${key}`);
  const values = count === undefined ? vars : { ...vars, count: number.format(count) };
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`Missing variable ${name} in ${locale}:${key}`);
    return value;
  });
}

function compose(locale: ChronicleLocale, facts: ChronicleFacts, context: ChronicleContext) {
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const city = (slug: string) =>
    lookup(locale, `cities.${slug}`) ?? context.cityNames.get(slug) ?? slug;
  // Un bien ou un décret ajoutés sans traduction sont dits par leur identifiant.
  const good = (id: string) => lookup(locale, `goods.${id}`) ?? id;
  const oboles = (count: number) => render(locale, 'oboles', {}, count);
  const here = city(context.citySlug);
  const paragraphs: string[][] = [];

  if (isQuietDay(facts)) paragraphs.push([render(locale, 'quiet', { city: here })]);
  const news = [
    ...(facts.configChange ? [render(locale, 'configChange')] : []),
    ...facts.worldEvents.map((event) =>
      render(locale, `worldEvents.${event.model}`, {
        city: city(event.cityId),
        other: city(event.otherCityId ?? ''),
        good: good(event.goodId ?? ''),
      }),
    ),
  ];
  const politics = [
    // Une maison introuvable n'a pas de nom : la phrase ne la nomme pas.
    ...facts.elections.map(({ houseName, votes }) =>
      render(locale, houseName === '' ? 'electionUnnamed' : 'election', {
        house: houseName,
        votes: render(locale, 'votes', {}, votes),
      }),
    ),
    ...facts.decrees.map(({ model, outcome, votesFor, votesAgainst }) =>
      render(locale, `decree.${outcome}`, {
        decree: lookup(locale, `decrees.${model}`) ?? model,
        for: number(votesFor ?? 0),
        against: number(votesAgainst ?? 0),
      }),
    ),
  ];
  const market = facts.goods.map((row) =>
    render(locale, row.lowPrice === row.highPrice ? 'goodOnePrice' : 'good', {
      good: good(row.goodId),
      traded: render(locale, 'traded', {}, row.volume),
      average: oboles(row.averagePrice),
      low: number(row.lowPrice),
      high: oboles(row.highPrice),
    }),
  );
  if (facts.otherGoods > 0) market.push(render(locale, 'otherGoods', {}, facts.otherGoods));
  if (market.length > 0) market.unshift(render(locale, 'market'));
  const port = facts.arrivals.map(({ fromCityId, ships }) =>
    render(locale, 'arrivals', {
      ships: render(locale, 'ships', {}, ships),
      city: city(fromCityId),
    }),
  );
  // Pertes en mer (#730) : comptées par route, sans nommer de maison.
  port.push(
    ...facts.losses.map(({ fromCityId, cargoes }) =>
      render(locale, 'losses', {
        cargoes: render(locale, 'cargoes', {}, cargoes),
        city: city(fromCityId),
      }),
    ),
  );
  paragraphs.push(news, politics, market, port);
  if (facts.population) {
    const { after, change } = facts.population;
    const direction = change > 0 ? 'up' : change < 0 ? 'down' : 'same';
    paragraphs.push([
      render(locale, `population.${direction}`, {
        population: render(locale, 'inhabitants', {}, after),
        change: number(Math.abs(change)),
      }),
    ]);
  }
  return paragraphs
    .filter((lines) => lines.length > 0)
    .map((lines) => lines.join(' '))
    .join('\n\n');
}

/** La chronique de repli d'une cité, en français et en anglais : des paragraphes séparés par une ligne vide. */
export function composeChronicle(facts: ChronicleFacts, context: ChronicleContext): ChronicleTexts {
  return { fr: compose('fr', facts, context), en: compose('en', facts, context) };
}
