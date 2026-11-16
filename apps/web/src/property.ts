import { z } from 'zod';

const id = z.string().min(1);

/** Parc de logements d'une cité pour une taille : biens au total, et ceux que la cité vend encore (4.5). */
export interface ParkSize {
  sizeId: string;
  total: number;
  forSale: number;
}

const parkRow = z.object({ id, size_id: id, for_sale: z.boolean() });

/**
 * Parc de logements d'une cité (vue publique `city_properties`), par taille, dans l'ordre des
 * identifiants. `null` si une ligne est illisible : l'écran annonce un échec de lecture.
 */
export function parkBySize(rows: unknown): ParkSize[] | null {
  const parsed = z.array(parkRow).safeParse(rows);
  if (!parsed.success) return null;
  const sizes = new Map<string, ParkSize>();
  for (const row of parsed.data) {
    const size = sizes.get(row.size_id) ?? { sizeId: row.size_id, total: 0, forSale: 0 };
    size.total += 1;
    if (row.for_sale) size.forSale += 1;
    sizes.set(row.size_id, size);
  }
  return [...sizes.values()].sort((a, b) => a.sizeId.localeCompare(b.sizeId));
}
