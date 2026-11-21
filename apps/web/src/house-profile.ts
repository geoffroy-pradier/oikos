import { blazonSchema, type Blazon } from '@oikos/contracts';
import { z } from 'zod';
import { useRows } from './data';
import { useHouse } from './house';

/**
 * Vues publiques que la fiche d'une maison lit, et elles seules (6.6) : le nom, le blason, la cité et le statut
 * (`houses`), la Timè (`house_honor`), les mandats (`offices`), la nature d'une maison PNJ de secours (`npc_houses`,
 * 8.3). Aucune vue `my_*`, aucune table du schéma `game`.
 */
export const PROFILE_VIEWS = ['houses', 'house_honor', 'offices', 'npc_houses'] as const;

const id = z.string().min(1);
const instant = z.string().transform((value, ctx) => {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) ctx.addIssue({ code: 'custom', message: 'not an instant' });
  return ms;
});

const houseRow = z.object({
  id,
  world_id: id,
  name: z.string().min(1),
  blazon: z.unknown(),
  city_id: id.nullable(),
  citizenship_status: z.enum(['metic', 'citizen']).nullable(),
});
const honorRow = z.object({ honor: z.number().int().min(Number.MIN_SAFE_INTEGER) });
const honorMarkRow = z.object({
  dishonored: z.boolean().default(false),
  dishonored_until_day: z.number().int().nullable().default(null),
});
const npcRow = z.object({ house_id: id });
const officeRow = z.object({
  office: z.string().min(1),
  city_id: id,
  starts_at: instant,
  ends_at: instant,
  in_office: z.boolean(),
});

export interface HouseProfile {
  id: string;
  name: string;
  blazon: Blazon | null;
  cityId: string | null;
  status: 'metic' | 'citizen' | null;
}
export interface Mandate {
  office: string;
  cityId: string;
  startsAt: number;
  endsAt: number;
  inOffice: boolean;
}

/**
 * La maison demandée, si elle existe dans le monde du joueur : les lignes lues sont la sienne et celle de la
 * maison demandée. `'unknown'` pour une maison absente, ou d'un autre monde : même issue, rien n'est révélé.
 * `null` si une ligne est illisible.
 */
export function parseProfile(
  rows: unknown,
  houseId: string,
  ownId: string,
): HouseProfile | 'unknown' | null {
  const parsed = z.array(houseRow).safeParse(rows);
  if (!parsed.success) return null;
  const wanted = parsed.data.find((row) => row.id === houseId);
  const own = parsed.data.find((row) => row.id === ownId);
  if (!wanted || !own || wanted.world_id !== own.world_id) return 'unknown';
  return {
    id: wanted.id,
    name: wanted.name,
    blazon: blazonSchema.safeParse(wanted.blazon).data ?? null,
    cityId: wanted.city_id,
    status: wanted.citizenship_status,
  };
}

/** Timè de la maison (`house_honor`, une ligne par maison, à zéro sans journal) ; `null` si illisible. */
export function parseHonor(rows: unknown): number | null {
  const parsed = z.array(honorRow).safeParse(rows);
  return parsed.success ? (parsed.data[0]?.honor ?? 0) : null;
}

/**
 * Marque de déshonneur de la maison (`house_honor`, 5.4) : `untilDay` est le premier jour de jeu sans marque, nul
 * tant que le prêt reste en défaut. Seule la marque est publique, jamais le prêt ni son montant. `null` si illisible.
 */
export function parseDishonor(
  rows: unknown,
): { dishonored: boolean; untilDay: number | null } | null {
  const parsed = z.array(honorMarkRow).safeParse(rows);
  if (!parsed.success) return null;
  const row = parsed.data[0];
  return { dishonored: row?.dishonored ?? false, untilDay: row?.dishonored_until_day ?? null };
}

/** La maison est-elle une maison PNJ de secours (`npc_houses`, une ligne au plus) ? `null` si illisible. */
export function parseNpc(rows: unknown): boolean | null {
  const parsed = z.array(npcRow).safeParse(rows);
  return parsed.success ? parsed.data.length > 0 : null;
}

/** Mandats en cours d'abord, puis les passés du plus récent au plus ancien ; `null` si illisibles. */
export function parseMandates(rows: unknown): Mandate[] | null {
  const parsed = z.array(officeRow).safeParse(rows);
  if (!parsed.success) return null;
  return parsed.data
    .map((row) => ({
      office: row.office,
      cityId: row.city_id,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      inOffice: row.in_office,
    }))
    .sort((a, b) => Number(b.inOffice) - Number(a.inOffice) || b.startsAt - a.startsAt);
}

/** Identifiant d'adresse lisible comme identifiant de maison ; sinon la maison est inconnue, sans lecture. */
export const isHouseId = (value: unknown): value is string =>
  typeof value === 'string' && z.uuid().safeParse(value).success;

/**
 * Lectures de la fiche. La Timè et les mandats ne sont lus qu'une fois la maison reconnue dans le monde du
 * joueur : une maison d'un autre monde n'a rien livré d'autre que sa ligne, écartée.
 */
export function useHouseProfile(houseId: string | undefined) {
  const own = useHouse();
  const wanted = isHouseId(houseId) ? houseId : null;
  const valid = wanted !== null;
  const houses = useRows<unknown>(
    'houses',
    'id, world_id, name, blazon, city_id, citizenship_status',
    'id',
    wanted ? { id: [wanted, own.id] } : null,
  );
  const profile = wanted && houses.rows !== null ? parseProfile(houses.rows, wanted, own.id) : null;
  const known = profile !== null && profile !== 'unknown';
  const honorRows = useRows<unknown>(
    'house_honor',
    'honor, dishonored, dishonored_until_day',
    'house_id',
    known && wanted ? { house_id: wanted } : null,
  );
  const officeRows = useRows<unknown>(
    'offices',
    'office, city_id, starts_at, ends_at, in_office',
    'starts_at',
    known && wanted ? { house_id: wanted } : null,
  );
  const npcRows = useRows<unknown>(
    'npc_houses',
    'house_id',
    'house_id',
    known && wanted ? { house_id: wanted } : null,
  );
  const honor = honorRows.rows === null ? null : parseHonor(honorRows.rows);
  const dishonor = honorRows.rows === null ? null : parseDishonor(honorRows.rows);
  const mandates = officeRows.rows === null ? null : parseMandates(officeRows.rows);
  const npc = npcRows.rows === null ? null : parseNpc(npcRows.rows);
  const reads = [houses, ...(known ? [honorRows, officeRows, npcRows] : [])];
  const failed =
    reads.some((read) => read.failed) ||
    (houses.rows !== null && profile === null) ||
    (known &&
      ((honorRows.rows !== null && (honor === null || dishonor === null)) ||
        (officeRows.rows !== null && mandates === null) ||
        (npcRows.rows !== null && npc === null)));
  return {
    /** `'unknown'` : maison absente ou d'un autre monde, y compris une adresse mal formée. */
    profile: valid ? profile : 'unknown',
    honor,
    dishonor,
    mandates,
    /** Maison PNJ de secours (8.3) : annoncée comme telle, à la place du statut. */
    npc,
    failed,
    loading:
      valid &&
      !failed &&
      (houses.rows === null || (known && (honor === null || mandates === null || npc === null))),
    reload: () => Promise.all(reads.map((read) => read.reload())),
  };
}
