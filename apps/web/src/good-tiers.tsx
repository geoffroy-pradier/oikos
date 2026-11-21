import { GoodIcon, type GoodIconProps } from '@oikos/ui';
import { createContext, useContext } from 'react';
import { z } from 'zod';

const rowSchema = z.object({ good_id: z.string().min(1), tier: z.string().min(1) });

/**
 * Niveau de chaque bien de la configuration en vigueur, par identifiant (vue `public.good_tiers`, une ligne par
 * bien, #873). Une ligne illisible est écartée, et la première ligne d'un bien l'emporte : le bien garde alors la
 * caisse, jamais un niveau supposé. Un niveau que `GoodIcon` ne dessine pas (`service`) donne aussi la caisse.
 */
export function parseGoodTiers(rows: unknown): ReadonlyMap<string, string> {
  const tiers = new Map<string, string>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const parsed = rowSchema.safeParse(row);
    if (parsed.success && !tiers.has(parsed.data.good_id)) {
      tiers.set(parsed.data.good_id, parsed.data.tier);
    }
  }
  return tiers;
}

/**
 * Niveaux lus par `GoodTiersProvider` (module à part : un écran qui rend un bien ne charge pas le client de
 * Supabase). Sans fournisseur (tests d'un écran seul), aucun niveau n'est connu : la caisse, comme avant #873.
 */
export const GoodTiersContext = createContext<ReadonlyMap<string, string>>(new Map());

/**
 * Pictogramme d'un bien dans un écran du jeu : `GoodIcon` avec le niveau publié du bien, pour qu'un bien sans
 * dessin propre (ajouté par Olympe) prenne celui de son niveau (#708).
 */
export function GoodPicture(props: Omit<GoodIconProps, 'tier'>) {
  const tier = useContext(GoodTiersContext).get(props.goodId);
  return <GoodIcon {...props} tier={tier ?? ''} />;
}
