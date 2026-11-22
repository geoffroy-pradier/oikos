import { INITIAL_CONFIG, validateConfig } from '@oikos/config';
import {
  chronicleFacts,
  type ChronicleFacts,
  type ChronicleInputEvent,
  type ChronicleLeagueChange,
} from '@oikos/sim';
import { describe, expect, it } from 'vitest';
import { composeChronicle, isQuietDay } from './compose';
import en from './locales/en.json' with { type: 'json' };
import fr from './locales/fr.json' with { type: 'json' };

const context = { citySlug: 'kalliste', cityNames: new Map([['nesos', 'Nèsos']]) };
const facts = (
  events: ChronicleInputEvent[],
  extra: Partial<Parameters<typeof chronicleFacts>[0]> = {},
) =>
  chronicleFacts({
    cityId: 'kalliste',
    events,
    worldEvents: [],
    population: null,
    maxGoods: 2,
    ...extra,
  });
const trade = (goodId: string, price: number, quantity: number) =>
  ({ type: 'trade', cityId: 'kalliste', goodId, price, quantity }) as const;
const FULL: ChronicleFacts = facts(
  [
    ...[trade('wheat', 6, 1000), trade('wheat', 7, 500), trade('wine', 20, 1), trade('salt', 9, 1)],
    { type: 'arrival', cityId: 'kalliste', fromCityId: 'elaia' },
    { type: 'arrival', cityId: 'kalliste', fromCityId: 'nesos' },
    { type: 'arrival', cityId: 'kalliste', fromCityId: 'nesos' },
    { type: 'loss', cityId: 'kalliste', fromCityId: 'nesos' },
    { type: 'election', cityId: 'kalliste', houseName: 'Alcméonides', votes: 1 },
    {
      type: 'decree',
      cityId: 'kalliste',
      model: 'festival',
      outcome: 'adopted',
      votesFor: 5,
      votesAgainst: 2,
    },
    { type: 'decree', cityId: 'kalliste', model: 'port_dues', outcome: 'applied' },
    { type: 'configScheduled', activateAt: 0 },
  ],
  {
    population: { before: 1203, after: 1191 },
    worldEvents: [
      { model: 'storm', cityId: 'kalliste', otherCityId: 'halos', goodId: null },
      { model: 'caravan', cityId: 'kalliste', otherCityId: null, goodId: 'wine' },
    ],
  },
);

describe('chronique de repli', () => {
  it('exemple complet en français : nouvelles, politique, agora, port, population', () => {
    expect(composeChronicle(FULL, context).fr.split('\n\n')).toEqual([
      "Par décision de l'Olympe, de nouvelles lois régissent le monde à compter de cette clôture. " +
        'Une tempête se lève sur la route entre Kallistè et Halos. ' +
        'Une caravane étrangère arrive à Kallistè et demande : Vin.',
      'La maison Alcméonides est élue archonte avec 1 voix. ' +
        "L'assemblée adopte le décret de fête : 5 pour, 2 contre. " +
        'Entrée en vigueur : le décret sur les droits de port.',
      // (6×1000 + 7×500) / 1500 = 6,33 → 6 ; séparateur des milliers : espace fine insécable.
      "Sur l'agora : Blé, 1 500 unités échangées à 6 oboles en moyenne (de 6 à 7 oboles). " +
        'Vin, 1 unité échangée à 20 oboles. Échanges aussi sur 1 autre bien.',
      // Une cité sans traduction garde son nom en base.
      'Au port, 2 navires arrivés depuis Nèsos. Au port, 1 navire arrivé depuis Elaia. ' +
        'Sur la route depuis Nèsos, 1 cargaison perdue en mer.',
      "La cité compte 1 191 habitants, 12 de moins qu'à la clôture précédente.",
    ]);
  });

  it('le même exemple en anglais, mêmes paragraphes', () => {
    const text = composeChronicle(FULL, context).en;
    expect(text.split('\n\n')).toHaveLength(5);
    expect(text).toContain('House Alcméonides is elected archon with 1 vote.');
    expect(text).toContain('Wheat, 1,500 units traded at 6 obols on average (from 6 to 7 obols).');
    expect(text).toContain('In the harbour, 2 ships arrived from Nèsos.');
    expect(text).toContain('On the route from Nèsos, 1 cargo lost at sea.');
    expect(text).toContain(
      'The city counts 1,191 inhabitants, 12 fewer than at the previous close.',
    );
  });

  it('journée calme : une phrase, puis la population ; sans population, la phrase seule', () => {
    const quiet = facts([], { population: { before: 4, after: 5 } });
    expect(isQuietDay(quiet)).toBe(true);
    expect(composeChronicle(quiet, context)).toEqual({
      fr:
        "Journée calme à Kallistè : ni échange sur l'agora, ni navire au port, ni décision de l'assemblée.\n\n" +
        "La cité compte 5 habitants, 1 de plus qu'à la clôture précédente.",
      en:
        'A quiet day in Kallistè: no trade in the agora, no ship in the harbour, no decision of the assembly.\n\n' +
        'The city counts 5 inhabitants, 1 more than at the previous close.',
    });
    expect(
      composeChronicle(facts([], { population: { before: 0, after: 0 } }), context).en,
    ).toContain('The population of the city holds at 0 inhabitants.');
    expect(composeChronicle(facts([]), context).fr.split('\n\n')).toHaveLength(1);
    expect(isQuietDay(facts([{ type: 'configScheduled', activateAt: 0 }]))).toBe(false);
    // Une perte en mer suffit à faire une journée qui n'est pas calme (#730), au pluriel s'il le faut.
    const lost = facts([
      { type: 'loss', cityId: 'kalliste', fromCityId: 'elaia' },
      { type: 'loss', cityId: 'kalliste', fromCityId: 'elaia' },
    ]);
    expect(isQuietDay(lost)).toBe(false);
    expect(composeChronicle(lost, context)).toEqual({
      fr: 'Sur la route depuis Elaia, 2 cargaisons perdues en mer.',
      en: 'On the route from Elaia, 2 cargoes lost at sea.',
    });
  });

  it('ligues (#737) : la cité fonde, rejoint, quitte une ligue, nommée ; ce n’est plus un jour calme', () => {
    const league = (leagueName: string, change: ChronicleLeagueChange) =>
      ({ type: 'league', cityId: 'kalliste', leagueName, change }) as const;
    const day = facts([
      league('Ligue de Délos', 'founded'),
      league('Ligue de Naxos', 'leftDissolved'),
    ]);
    expect(isQuietDay(day)).toBe(false);
    expect(composeChronicle(day, context)).toEqual({
      fr: "La cité fonde la ligue « Ligue de Délos » et en prend l'hégémonie. La cité quitte la ligue « Ligue de Naxos », qui se dissout.",
      en: 'The city founds the league “Ligue de Délos” and takes its hegemony. The city leaves the league “Ligue de Naxos”, which dissolves.',
    });
  });

  it('une maison élue introuvable n’est pas nommée', () => {
    const elected = facts([{ type: 'election', cityId: 'kalliste', houseName: '', votes: 2 }]);
    expect(composeChronicle(elected, context)).toEqual({
      fr: 'Une maison est élue archonte avec 2 voix.',
      en: 'A house is elected archon with 2 votes.',
    });
  });

  it('un bien ou un décret sans traduction sont dits par leur identifiant', () => {
    const odd = facts([
      trade('amber', 3, 2),
      { type: 'decree', cityId: 'kalliste', model: 'ostracism', outcome: 'lapsed' },
    ]);
    const text = composeChronicle(odd, context).en;
    expect(text).toContain('amber, 2 units traded at 3 obols.');
    expect(text).toContain('Without effect: ostracism.');
  });

  it('les deux langues ont les mêmes gabarits, et nomment chaque bien et chaque cité de la configuration', () => {
    const keys = (node: object, prefix = ''): string[] =>
      Object.entries(node).flatMap(([key, value]) =>
        typeof value === 'object' && value !== null
          ? keys(value as object, `${prefix}${key}.`)
          : [`${prefix}${key}`],
      );
    expect(keys(en).sort()).toEqual(keys(fr).sort());
    const named = (locale: typeof fr) => [
      Object.keys(locale.goods).sort(),
      Object.keys(locale.cities).sort(),
    ];
    const initial = validateConfig(INITIAL_CONFIG);
    if (!initial.ok) throw new Error(initial.errors.join('\n'));
    const { goods, cities } = initial.config;
    const config = [goods.map((good) => good.id).sort(), cities.map((c) => c.id).sort()];
    expect(named(fr)).toEqual(config);
    expect(named(en)).toEqual(config);
  });
});
