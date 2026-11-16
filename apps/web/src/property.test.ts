import { describe, expect, it } from 'vitest';
import { parkBySize } from './property';

describe('parc de logements (#259)', () => {
  it('parc d’une cité par taille : total et biens encore à vendre ; ligne illisible : échec', () => {
    const rows = [
      { id: 'p1', size_id: 'townhouse', for_sale: true },
      { id: 'p2', size_id: 'townhouse', for_sale: false },
      { id: 'p3', size_id: 'tenement', for_sale: true },
    ];
    expect(parkBySize(rows)).toEqual([
      { sizeId: 'tenement', total: 1, forSale: 1 },
      { sizeId: 'townhouse', total: 2, forSale: 1 },
    ]);
    expect(parkBySize([{ id: 'p1', size_id: 'townhouse' }])).toBeNull();
  });
});
