import { stewardRuleSchema, stewardRulesSchema, type StewardRule } from '@oikos/contracts';
import { z } from 'zod';

/** Intendant en poste d'un site de la maison (vues `my_stewards` et `my_steward_rules`, #278). */
export interface Steward {
  id: string;
  siteId: string;
  name: string;
  /**
   * `active` : payé par la dernière clôture, il mène ses règles ; `hired` : embauché depuis la dernière clôture,
   * il attend celle qui le paiera ; `unpaid` : la dernière clôture n'a pas pu le payer.
   */
  state: 'active' | 'hired' | 'unpaid';
  /** Instant de l'impayé, ou de l'embauche, pour un intendant qui n'agit pas. */
  since: Date | null;
  /** Révision en vigueur de ses règles (`rules_revision`) : une intention de règles la porte. */
  revision: number;
  rules: StewardRule[];
}

const uuid = z.string().min(1);
const stewardRow = z.object({
  id: uuid,
  site_id: uuid,
  name: z.string().min(1),
  hired_at: z.string(),
  unpaid_since: z.string().nullable(),
  rules_revision: z.number().int().nonnegative(),
});
// Les montants `bigint` arrivent en nombres ou en textes de chiffres.
const amount = z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)]).nullable();
const ruleRow = z.object({
  steward_id: uuid,
  position: z.number().int(),
  kind: z.string(),
  good_id: z.string().nullable(),
  price_oboles: amount,
  units: amount,
});

/** Une ligne de `my_steward_rules` dans la grammaire, ou `null` si elle n'y entre pas. */
function ruleOf(row: z.infer<typeof ruleRow>): StewardRule | null {
  const { kind, good_id: goodId, price_oboles: price, units } = row;
  const rule =
    kind === 'collect'
      ? { kind }
      : kind === 'sell'
        ? { kind, goodId, minPriceOboles: price, keepUnits: units }
        : { kind, goodId, maxPriceOboles: price, targetUnits: units };
  const parsed = stewardRuleSchema.safeParse(rule);
  return parsed.success ? parsed.data : null;
}

/**
 * Intendants de la maison par site, leurs règles dans leur ordre. Une ligne illisible est ignorée : un intendant
 * illisible n'est pas affiché, une règle illisible n'est pas montrée (l'API garde les règles en vigueur).
 */
export function parseStewards(
  stewards: readonly unknown[],
  rules: readonly unknown[],
): Map<string, Steward> {
  const parsedRules = rules.flatMap((raw) => {
    const row = ruleRow.safeParse(raw);
    const rule = row.success ? ruleOf(row.data) : null;
    return row.success && rule ? [{ ...row.data, rule }] : [];
  });
  return new Map(
    stewards.flatMap((raw) => {
      const row = stewardRow.safeParse(raw);
      if (!row.success) return [];
      const { id, site_id: siteId, name, hired_at: hiredAt, unpaid_since: unpaidSince } = row.data;
      const revision = row.data.rules_revision;
      const state = unpaidSince === null ? 'active' : unpaidSince === hiredAt ? 'hired' : 'unpaid';
      const own = parsedRules.filter((rule) => rule.steward_id === id);
      own.sort((a, b) => a.position - b.position);
      const since = unpaidSince === null ? null : new Date(unpaidSince);
      const steward: Steward = {
        id,
        siteId,
        name,
        state,
        since,
        revision,
        rules: own.map((r) => r.rule),
      };
      return [[siteId, steward] as const];
    }),
  );
}

/** Une règle telle que le formulaire la saisit : sorte, bien, prix et quantité en texte. */
export interface RuleDraft {
  kind: StewardRule['kind'];
  goodId: string;
  price: string;
  units: string;
}

export const draftOf = (rule: StewardRule): RuleDraft =>
  rule.kind === 'collect'
    ? { kind: 'collect', goodId: '', price: '', units: '' }
    : rule.kind === 'sell'
      ? { ...rule, price: String(rule.minPriceOboles), units: String(rule.keepUnits) }
      : { ...rule, price: String(rule.maxPriceOboles), units: String(rule.targetUnits) };

/** Entier écrit en chiffres, sinon `NaN` : le schéma refuse alors la règle. */
const integer = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : NaN);

/**
 * Les règles saisies, validées par la grammaire du contrat, ou la première ligne fautive (`invalid`, son rang) :
 * un nombre illisible ou hors bornes, un bien manquant, une règle en double. L'API reste seule juge du reste.
 */
export function rulesOf(
  drafts: readonly RuleDraft[],
): { rules: StewardRule[] } | { invalid: number } {
  const rules = drafts.map((draft) =>
    draft.kind === 'collect'
      ? { kind: draft.kind }
      : draft.kind === 'sell'
        ? {
            kind: draft.kind,
            goodId: draft.goodId,
            minPriceOboles: integer(draft.price),
            keepUnits: integer(draft.units),
          }
        : {
            kind: draft.kind,
            goodId: draft.goodId,
            maxPriceOboles: integer(draft.price),
            targetUnits: integer(draft.units),
          },
  );
  const parsed = stewardRulesSchema.safeParse(rules);
  if (parsed.success) return { rules: parsed.data };
  const first = parsed.error.issues[0]?.path[0];
  return { invalid: typeof first === 'number' ? first : 0 };
}

type Stacks = { inputs: { goodId: string }[]; outputs: { goodId: string }[] } | null;

/** Biens qu'une règle peut viser : un rachat, les intrants ; une vente, les extrants puis les intrants. */
export function goodsFor(recipe: Stacks, row: Pick<RuleDraft, 'kind' | 'goodId'>): string[] {
  const inputs = recipe?.inputs.map((stack) => stack.goodId) ?? [];
  const outputs = recipe?.outputs.map((stack) => stack.goodId) ?? [];
  const offered = row.kind === 'buy' ? inputs : [...new Set([...outputs, ...inputs])];
  return row.goodId && !offered.includes(row.goodId) ? [row.goodId, ...offered] : offered;
}

/** Règle neuve de cette sorte, sur le premier bien proposé, sans nombre. */
export const blankRule = (recipe: Stacks, kind: RuleDraft['kind']): RuleDraft => ({
  kind,
  goodId: kind === 'collect' ? '' : (goodsFor(recipe, { kind, goodId: '' })[0] ?? ''),
  price: '',
  units: '',
});

/** La ligne `index` passe avant la précédente. */
export const moveUp = <T>(rows: readonly T[], index: number): T[] =>
  index <= 0 || index >= rows.length
    ? [...rows]
    : rows.map(
        (row, rank) => rows[rank === index ? index - 1 : rank === index - 1 ? index : rank] ?? row,
      );

/** Intention d'une embauche : le site. */
export const hireIntent = (siteId: string) => `hire:${siteId}`;

/** Intention de règles : l'intendant, la révision lue et les règles envoyées. */
export const rulesIntent = (steward: Pick<Steward, 'id' | 'revision'>, rules: StewardRule[]) =>
  `rules:${steward.id}:${steward.revision}:${JSON.stringify(rules)}`;

/**
 * Intentions du site que la lecture rend caduques, restées en attente après une réponse perdue : l'embauche dès
 * qu'un intendant y est lu (une réembauche après un renvoi prend une clé neuve), et les règles d'une révision
 * antérieure à celle lue.
 */
export const staleIntents =
  (siteId: string, steward: Pick<Steward, 'id' | 'revision'> | undefined) => (intent: string) => {
    if (!steward) return false;
    if (intent === hireIntent(siteId)) return true;
    const revision = new RegExp(`^rules:${steward.id}:(\\d+):`).exec(intent)?.[1];
    return revision !== undefined && Number(revision) < steward.revision;
  };
