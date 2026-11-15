import { cityHasPort } from '@oikos/config/schema';
import type { TFunction } from 'i18next';
import { z } from 'zod';

/** Ligne de la vue publique `city_identity` (docs/specs/06-cites-politique-communaute.md, 6.1). */
const rowSchema = z.object({
  city_id: z.string().min(1),
  // Champs nuls : version de configuration antérieure aux quatre cités (valeurs par défaut partagées).
  terroir: z.array(z.string().min(1)).nullable(),
  has_port: z.boolean().nullable(),
  patron_god_id: z.string().min(1).nullable(),
  starting_recipe_id: z.string().min(1),
});

export interface CityIdentity {
  /** Recettes de production primaire admises ; `null` : toutes (les ateliers le sont partout). */
  terroir: string[] | null;
  hasPort: boolean;
  patronGodId: string | null;
  startingRecipeId: string;
}

/**
 * Lit l'identité des cités, par identifiant de cité. `null` si une ligne est illisible : l'écran annonce
 * un échec plutôt qu'une identité fausse. Une cité sans ligne n'est pas dans la configuration.
 */
export function parseCityIdentities(raw: unknown): Map<string, CityIdentity> | null {
  const parsed = z.array(rowSchema).safeParse(raw);
  if (!parsed.success) return null;
  return new Map(
    parsed.data.map((row) => [
      row.city_id,
      {
        terroir: row.terroir,
        hasPort: cityHasPort({ hasPort: row.has_port ?? undefined }),
        patronGodId: row.patron_god_id,
        startingRecipeId: row.starting_recipe_id,
      },
    ]),
  );
}

/**
 * Identité d'une cité en quatre lignes traduites : dieu protecteur, port, terroir, premier site. Un
 * identifiant ajouté par le back-office sans traduction s'affiche tel quel.
 */
export function describeCity(identity: CityIdentity, t: TFunction, language: string) {
  const recipe = (id: string) => t(`recipes.${id}`, { defaultValue: id });
  const list = new Intl.ListFormat(language, { type: 'conjunction' });
  return {
    god: identity.patronGodId
      ? t('cityIdentity.god', {
          god: t(`gods.${identity.patronGodId}`, { defaultValue: identity.patronGodId }),
        })
      : t('cityIdentity.noGod'),
    port: t(identity.hasPort ? 'cityIdentity.port' : 'cityIdentity.noPort'),
    terroir:
      identity.terroir === null
        ? t('cityIdentity.anyTerroir')
        : t('cityIdentity.terroir', { list: list.format(identity.terroir.map(recipe)) }),
    start: t('cityIdentity.start', { recipe: recipe(identity.startingRecipeId) }),
  };
}
