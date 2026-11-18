import {
  STEWARD_PROPOSAL_REFUSALS,
  stewardOperationSummarySchema,
  stewardRuleSchema,
  stewardRulesSchema,
  stewardSimulationSchema,
  type StewardOperationSummary,
  type StewardProposalRefusal,
  type StewardRule,
  type StewardSimulationStep,
} from '@oikos/contracts';
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

/** Une opération menée par un intendant (vue `my_steward_operations`, #279). */
export interface StewardOperation {
  at: Date;
  /** `ok` : la commande a eu son effet ; `rejected` : refusée, sans effet, pour la raison `code`. */
  status: 'ok' | 'rejected';
  code: string | null;
  kind: 'collect' | 'sell' | 'buy';
  goodId: string | null;
  summary: StewardOperationSummary;
}
/** Les dernières opérations d'un intendant, la plus récente d'abord, et son dernier refus. */
export interface StewardActivity {
  recent: StewardOperation[];
  lastRefusal: StewardOperation | null;
}
/** Opérations montrées par la fiche d'un site : celles que la vue rend, au plus. */
export const RECENT_OPERATIONS = 5;

const operationRow = z.object({
  steward_id: uuid,
  tick_index: z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)]),
  rank: z.number().int(),
  created_at: z.string(),
  status: z.enum(['ok', 'rejected']),
  error_code: z.string().nullable(),
  kind: z.enum(['collect', 'sell', 'buy']),
  good_id: z.string().nullable(),
  summary: stewardOperationSummarySchema,
});

/** Activité de chaque intendant de la maison ; une ligne illisible est ignorée. */
export function parseStewardActivity(rows: readonly unknown[]): Map<string, StewardActivity> {
  const parsed = rows.flatMap((raw) => {
    const row = operationRow.safeParse(raw);
    return row.success ? [row.data] : [];
  });
  parsed.sort((a, b) => b.tick_index - a.tick_index || b.rank - a.rank);
  const activity = new Map<string, StewardActivity>();
  for (const row of parsed) {
    const operation: StewardOperation = {
      at: new Date(row.created_at),
      status: row.status,
      code: row.error_code,
      kind: row.kind,
      goodId: row.good_id,
      summary: row.summary,
    };
    const own = activity.get(row.steward_id) ?? { recent: [], lastRefusal: null };
    if (own.recent.length < RECENT_OPERATIONS) own.recent.push(operation);
    if (operation.status === 'rejected' && !own.lastRefusal) own.lastRefusal = operation;
    activity.set(row.steward_id, own);
  }
  return activity;
}

/**
 * Dernière consigne d'un intendant et sa réponse (vue `my_steward_instructions`, #280) : en attente du moteur, ou
 * répondue par des règles proposées et leur simulation à blanc, ou par un refus motivé.
 */
export interface StewardInstruction {
  stewardId: string;
  /** Révision des règles lue à la consigne : la proposition ne vaut que tant que l'intendant y est. */
  revision: number;
  /** Texte du joueur ; `null` une fois effacé à la conservation. */
  text: string | null;
  status: 'pending' | 'answered';
  rules: StewardRule[] | null;
  /** Simulation des règles proposées ; `null` si elle n'a pas pu être faite. */
  simulation: StewardSimulationStep[] | null;
  refusal: StewardProposalRefusal | null;
}

const instructionRow = z.object({
  steward_id: uuid,
  rules_revision: z.number().int().nonnegative(),
  text: z.string().nullable(),
  status: z.enum(['pending', 'answered']),
  rules: stewardRulesSchema.nullable(),
  simulation: stewardSimulationSchema.nullable().catch(null),
  refusal: z.enum(STEWARD_PROPOSAL_REFUSALS).nullable(),
});

/** Dernière consigne de chaque intendant de la maison ; une ligne illisible est ignorée. */
export function parseInstructions(rows: readonly unknown[]): Map<string, StewardInstruction> {
  return new Map(
    rows.flatMap((raw) => {
      const row = instructionRow.safeParse(raw);
      if (!row.success) return [];
      const { steward_id: stewardId, rules_revision: revision, ...rest } = row.data;
      return [[stewardId, { stewardId, revision, ...rest }] as const];
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

/** Intention d'une consigne : l'intendant, la révision lue et le texte envoyé. */
export const instructionIntent = (steward: Pick<Steward, 'id' | 'revision'>, text: string) =>
  `instruction:${steward.id}:${steward.revision}:${text}`;

/**
 * Intentions du site que la lecture rend caduques, restées en attente après une réponse perdue : l'embauche dès
 * qu'un intendant y est lu (une réembauche après un renvoi prend une clé neuve), et les règles ou la consigne d'une
 * révision antérieure à celle lue.
 */
export const staleIntents =
  (siteId: string, steward: Pick<Steward, 'id' | 'revision'> | undefined) => (intent: string) => {
    if (!steward) return false;
    if (intent === hireIntent(siteId)) return true;
    const revision = new RegExp(`^(?:rules|instruction):${steward.id}:(\\d+):`).exec(intent)?.[1];
    return revision !== undefined && Number(revision) < steward.revision;
  };
