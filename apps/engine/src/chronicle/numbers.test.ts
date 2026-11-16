import { chronicleFacts, type ChronicleInputEvent } from '@oikos/sim';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { composeChronicle } from './compose';
import { chronicleNames, numberIssues, numbersInText, writtenNumbers } from './numbers';

const context = { citySlug: 'kalliste', cityNames: new Map([['nesos', 'Nèsos 7']]) };
const facts = chronicleFacts({
  cityId: 'kalliste',
  events: [{ type: 'trade', cityId: 'kalliste', goodId: 'wheat', price: 6, quantity: 1500 }],
  worldEvents: [],
  population: { before: 1203, after: 1191 },
  maxGoods: 3,
});
const issues = (text: string) => numberIssues(text, facts, chronicleNames(facts, context));
// Faits d'un jour où la maison `houseName` est élue, et ce que le contrôle relève dans `text` ce jour-là.
const elected = (houseName: string) =>
  chronicleFacts({
    ...{ cityId: 'kalliste', worldEvents: [], population: null, maxGoods: 3 },
    events: [{ type: 'election', cityId: 'kalliste', houseName, votes: 3 }],
  });
const electedIssues = (houseName: string, text: string) =>
  numberIssues(text, elected(houseName), chronicleNames(elected(houseName), context));

describe('nombres d’un texte', () => {
  it('lit les milliers de chaque langue, apostrophe comprise ; un décimal se lit `NaN`', () => {
    expect(numbersInText("1 500 unités, 1,500 units, 1 500, 1.500, 1'500 ; 12 de moins.")).toEqual([
      1500, 1500, 1500, 1500, 1500, 12,
    ]);
    expect(numbersInText('6,5 oboles, 2.50 obols, 1,2345')).toEqual([
      Number.NaN,
      Number.NaN,
      Number.NaN,
    ]);
    expect(numbersInText('le 3e jour, 2024, 15 navires')).toEqual([3, 2024, 15]);
    // Un nom retiré ne colle pas deux nombres : « 1 Nèsos 7 500 » donne 1 et 500.
    expect(numbersInText('1 Nèsos 7 500', ['Nèsos 7'])).toEqual([1, 500]);
  });

  it('refuse tout nombre écrit autrement qu’en chiffres latins, ou absent des faits', () => {
    for (const text of [
      'deux mille navires',
      'le blé à vingt oboles',
      'Dix-sept navires, quatre-vingts habitants.',
      'XII navires',
      'le XIIe siècle, the XIIth century',
      'Ⅻ navires',
      '½ obole',
      '٣ navires',
      'x² oboles',
      'thirty ships',
      'Twelve ships, a hundred obols.',
      "1'499 habitants",
      '1’501 habitants',
      'Une dizaine de navires, une centaine d’habitants, des milliers d’oboles.',
      'La moitié du blé, un demi-navire, le double du prix.',
      'A dozen ships, half the wheat, twice the price.',
      'le troisième navire',
      'the fifth ship',
      'zéro navire',
      'Le prix du blé a doublé, puis a décuplé ; les ventes ont triplé, quadruplé, quintuplé, centuplé.',
      'The price of wheat doubled, then tripled and quadrupled.',
      'A tenfold rise, a twofold harvest; the price halved.',
      'Une huitaine de navires, une neuvaine, une quinzaine, une myriade d’oboles.',
      'Le second navire, la seconde caravane.',
      'The second ship; both cities; a trio, a duo.',
      'Un siècle, une décennie, un centenaire, un millénaire.',
      'A century, two centuries, a decade; nil, nought.',
      'Le blé à 6,5 oboles.',
    ])
      expect(issues(text), text).not.toEqual([]);
  });

  it('refuse chaque forme dérivée ou quantité, une à une', () => {
    const words =
      'doublé décuplé triplé quadruplé quintuplé centuplé doubled tripled tenfold twofold halved huitaine neuvaine quinzaine myriade second seconde secondes both trio duo siècle décennie centenaire millénaire century centuries decade nil nought';
    for (const word of words.split(' '))
      expect(writtenNumbers(`Le ${word} navire.`), word).toEqual([word]);
  });

  it('laisse passer un, une, one, a, les noms de la configuration et ceux qui ressemblent à des chiffres romains', () => {
    for (const text of [
      'Un navire, une caravane, one ship, a storm.',
      'Delphes, Milet, Kallistè, Elaia, Ampelos, Halos et Nèsos 7.',
      'Blé, Olives, Raisin, Bois, Argile, Laine, Poisson, Sel, Farine, Huile d’olive, Vin, Amphores.',
      'Wheat, Grapes, Wood, Clay, Wool, Fish, Salt, Flour, Olive oil, Charcoal, Cloth, Bread, Wine, Amphorae.',
      'Les Alcméonides et les Philaïdes ; I am here ; Vive la cité ; Mme Dion.',
      'Le blé, 1 500 unités, à 6 oboles ; la cité compte 1 191 âmes, 12 de moins.',
    ])
      expect(issues(text), text).toEqual([]);
    // Un nom donné qui porte un mot de nombre est retiré avant le contrôle (cités et biens).
    expect(writtenNumbers('Le port de Deux Rives.', ['Deux Rives'])).toEqual([]);
  });

  it('ne retire un nom que s’il forme un mot entier : « Vin » ne cache pas « Vingt »', () => {
    expect(issues('Vingt navires mouillent au port.')).toEqual(['Vingt']);
    expect(issues('Vingt et un navires.')).toEqual(['Vingt']);
    expect(issues('Le Vin de Milet ; wine ; Kallistè.')).toEqual([]);
    expect(electedIssues('rois', 'La maison rois. Le blé à trois oboles.')).toEqual(['trois']);
    expect(electedIssues('ille', 'La maison ille ; mille oboles.')).toEqual(['mille']);
    expect(electedIssues('oubl', 'La maison oubl ; le prix a doublé.')).toEqual(['doublé']);
    expect(electedIssues('ingt', 'La maison ingt ; vingt navires.')).toEqual(['vingt']);
    const words = writtenNumbers('Sextuplé, septuplé, octupled ; trillion, quadrillions, zillion.');
    expect(words.join(' ')).toBe('Sextuplé septuplé octupled trillion quadrillions zillion');
  });

  it('une maison élue au nom sans nombre est retirée avant le contrôle ; « Mille Oboles », « Deux Rives » non', () => {
    const check = (name: string) => electedIssues(name, `La maison ${name} est élue avec 3 voix.`);
    expect(check('Philaïdes')).toEqual([]);
    expect(check('Mille Oboles')).toEqual(['Mille']);
    expect(check('Deux Rives')).toEqual(['Deux']);
    expect(chronicleNames(elected('Deux Rives'), context)).not.toContain('Deux Rives');
    expect(chronicleNames(elected('Philaïdes'), context)).toContain('Philaïdes');
  });

  it('la chronique de repli, quels que soient les faits, est toujours acceptée', () => {
    const city = fc.constantFrom('kalliste', 'elaia', 'halos', 'nesos');
    const event = fc.oneof(
      fc.record({
        type: fc.constant('trade' as const),
        cityId: fc.constant('kalliste'),
        goodId: fc.constantFrom('wheat', 'wine', 'salt', 'olive_oil', 'amber'),
        price: fc.integer({ min: 1, max: 100_000 }),
        quantity: fc.integer({ min: 1, max: 100_000 }),
      }),
      fc.record({
        type: fc.constant('arrival' as const),
        cityId: fc.constant('kalliste'),
        fromCityId: city,
      }),
      fc.record({
        type: fc.constant('election' as const),
        cityId: fc.constant('kalliste'),
        houseName: fc.constantFrom('Philaïdes', 'Alcméonides', ''),
        votes: fc.nat(10_000),
      }),
      fc.record({
        type: fc.constant('decree' as const),
        cityId: fc.constant('kalliste'),
        model: fc.constantFrom('market_tax_rate', 'port_dues', 'public_works', 'festival'),
        outcome: fc.constantFrom('adopted' as const, 'rejected' as const),
        votesFor: fc.nat(5_000),
        votesAgainst: fc.nat(5_000),
      }),
      fc.record({
        type: fc.constant('decree' as const),
        cityId: fc.constant('kalliste'),
        model: fc.constantFrom('market_tax_rate', 'port_dues', 'public_works', 'festival'),
        outcome: fc.constantFrom('applied' as const, 'lapsed' as const),
      }),
      fc.record({ type: fc.constant('configScheduled' as const), activateAt: fc.constant(0) }),
    );
    const worldEvent = fc.record({
      model: fc.constantFrom(
        'drought' as const,
        'good_year' as const,
        'storm' as const,
        'caravan' as const,
      ),
      cityId: fc.constant('kalliste'),
      otherCityId: fc.option(city, { nil: null }),
      goodId: fc.option(fc.constantFrom('wine', 'fish'), { nil: null }),
    });
    const population = fc.option(
      fc.record({ before: fc.nat(5_000_000), after: fc.nat(5_000_000) }),
      {
        nil: null,
      },
    );
    fc.assert(
      fc.property(
        fc.array(event, { maxLength: 30 }),
        fc.array(worldEvent, { maxLength: 4 }),
        population,
        fc.nat(6),
        (events, worldEvents, people, maxGoods) => {
          const day = chronicleFacts({
            cityId: 'kalliste',
            events: events as ChronicleInputEvent[],
            worldEvents,
            population: people,
            maxGoods,
          });
          const texts = composeChronicle(day, context);
          const names = chronicleNames(day, context);
          expect(numberIssues(texts.fr, day, names)).toEqual([]);
          expect(numberIssues(texts.en, day, names)).toEqual([]);
        },
      ),
    );
  });
});
