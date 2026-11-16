import { useRef } from 'react';
import { useRows } from './data';
import { useHouse } from './house';
import { parseHouseNames, statusOf } from './politics';

/**
 * Identifiants lus d'un coup, au plus : la liste part dans l'adresse de la lecture (`id=in.(…)`), et une
 * adresse trop longue est refusée par le serveur. Limite technique de la lecture, pas d'équilibrage.
 */
export const CITED_HOUSES_PER_READ = 100;

/**
 * Identifiants à lire : la maison du joueur d'abord, puis les maisons citées dans l'ordre donné (les plus
 * importantes d'abord), sans doublon ni vide, bornés à `CITED_HOUSES_PER_READ`, puis triés : la même
 * liste de maisons donne toujours le même filtre, et la lecture ne repart pas à chaque rendu.
 */
export function citedHouseIds(houseId: string, cited: readonly (string | undefined)[]): string[] {
  const ids = new Set([houseId]);
  for (const id of cited) if (id) ids.add(id);
  return [...ids].slice(0, CITED_HOUSES_PER_READ).sort();
}

/**
 * Noms des maisons citées par un écran de la cité, et statut de la maison du joueur relu dans sa propre
 * ligne de la vue `houses` (#441) : on ne lit que ces lignes, jamais toutes les maisons de la cité, que la
 * lecture plafonne à 1 000. Rien n'est lu tant que `cited` vaut `null`. La maison du joueur est toujours
 * lue : se porter candidate ne change pas la liste. Quand la liste change, les noms déjà lus restent
 * affichés le temps de la nouvelle lecture : l'écran ne repasse pas par le chargement.
 */
export function useCitedHouses(cited: readonly (string | undefined)[] | null) {
  const house = useHouse();
  const ids = cited === null ? null : citedHouseIds(house.id, cited);
  const read = useRows<unknown>('houses', 'id, name, citizenship_status', 'id', ids && { id: ids });
  const names = read.rows === null ? null : parseHouseNames(read.rows);
  const status = read.rows === null ? null : statusOf(read.rows, house.id);
  const last = useRef<{ names: Map<string, string>; status: typeof status } | null>(null);
  if (names) last.current = { names, status };
  const shown = names
    ? { names, status }
    : read.rows === null && !read.failed
      ? last.current
      : null;
  return {
    names: shown?.names ?? null,
    status: shown?.status ?? null,
    /** Lecture en cours, rien encore à montrer ; jamais vrai tant que `cited` vaut `null`. */
    loading: ids !== null && read.rows === null && !read.failed && last.current === null,
    failed: read.failed || (read.rows !== null && names === null),
    reload: read.reload,
  };
}
