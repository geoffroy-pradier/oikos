import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GOOD_ICON_IDS, GOOD_TIER_IDS, GoodIcon } from '.';

const draw = (goodId: string, tier = '') =>
  renderToStaticMarkup(<GoodIcon goodId={goodId} tier={tier} />);

describe('GoodIcon : repli par niveau (#708)', () => {
  it('un bien sans dessin propre prend celui de son niveau, distinct pour chacun des trois', () => {
    expect([...GOOD_TIER_IDS].sort()).toEqual(['finished', 'intermediate', 'raw']);
    const tiers = GOOD_TIER_IDS.map((tier) => draw('ambrosia', tier));
    const goods = GOOD_ICON_IDS.map((id) => draw(id));
    expect(new Set([...tiers, ...goods, draw('ambrosia')]).size).toBe(
      GOOD_TIER_IDS.length + GOOD_ICON_IDS.length + 1,
    );
  });

  it('un bien dessiné garde son dessin ; un niveau inconnu ou absent donne la caisse neutre', () => {
    expect(draw('wheat', 'finished')).toBe(draw('wheat'));
    expect(draw('ambrosia', 'divine')).toBe(draw('ambrosia'));
    expect(draw('ambrosia', 'constructor')).toBe(draw('ambrosia'));
  });
});
