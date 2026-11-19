import {
  boundedDecreeParamsSchemas,
  decreeProposalSchema,
  type DecreeModel,
  type DecreeModelBounds,
  type DecreeProposal,
} from '@oikos/contracts';
import { z } from 'zod';

const id = z.string().min(1);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const bps = z.number().int().min(0).max(10_000);
const time = z.string().transform((value, ctx) => {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) ctx.addIssue({ code: 'custom', message: 'not an instant' });
  return ms;
});

/** États d'un décret (6.3) : au vote, adopté, rejeté, appliqué, caduc (dépense que le trésor ne couvrait plus). */
export const DECREE_STATUSES = ['proposed', 'adopted', 'rejected', 'applied', 'lapsed'] as const;
export type DecreeStatus = (typeof DECREE_STATUSES)[number];

/** Décret de la cité (vue publique `decrees`). Le décompte n'est connu qu'après le dépouillement. */
export interface Decree {
  id: string;
  cityId: string;
  /** Modèle et paramètres ; `null` si les paramètres stockés ne se lisent plus. */
  proposal: DecreeProposal | null;
  model: string;
  status: DecreeStatus;
  proposedBy: string;
  proposedAt: number;
  votingClosesAt: number;
  quorumBps: number;
  talliedAt: number | null;
  electorate: number | null;
  votesFor: number | null;
  votesAgainst: number | null;
  appliedAt: number | null;
}

const decreeRow = z.object({
  id,
  city_id: id,
  model: z.string().min(1),
  params: z.unknown(),
  proposed_by: id,
  status: z.enum(DECREE_STATUSES),
  proposed_at: time,
  voting_closes_at: time,
  quorum_bps: bps,
  tallied_at: time.nullable(),
  electorate: count.nullable(),
  votes_for: count.nullable(),
  votes_against: count.nullable(),
  applied_at: time.nullable(),
});

/** Décrets lus, les plus récents d'abord ; `null` si une ligne est illisible (hors paramètres). */
export function parseDecrees(rows: unknown): Decree[] | null {
  const parsed = z.array(decreeRow).safeParse(rows);
  if (!parsed.success) return null;
  return parsed.data
    .map((row) => {
      const proposal = decreeProposalSchema.safeParse({ model: row.model, params: row.params });
      return {
        id: row.id,
        cityId: row.city_id,
        proposal: proposal.success ? proposal.data : null,
        model: row.model,
        status: row.status,
        proposedBy: row.proposed_by,
        proposedAt: row.proposed_at,
        votingClosesAt: row.voting_closes_at,
        quorumBps: row.quorum_bps,
        talliedAt: row.tallied_at,
        electorate: row.electorate,
        votesFor: row.votes_for,
        votesAgainst: row.votes_against,
        appliedAt: row.applied_at,
      };
    })
    .sort((a, b) => b.proposedAt - a.proposedAt);
}

/** Décrets au vote, adoptés ou appliqués (en vigueur), puis le reste : rejetés et caducs. */
export function groupDecrees(decrees: readonly Decree[]) {
  return {
    open: decrees.filter((decree) => decree.status === 'proposed'),
    passed: decrees.filter((decree) => decree.status === 'adopted' || decree.status === 'applied'),
    other: decrees.filter((decree) => decree.status === 'rejected' || decree.status === 'lapsed'),
  };
}

/**
 * Décrets de taux en vigueur : pour chaque modèle de taux, le dernier appliqué (6.3), comme le moteur
 * l'arbitre (date d'application, puis fin du vote, puis identifiant). Une dépense n'est jamais « en vigueur ».
 */
export function ratesInForce(decrees: readonly Decree[]): Set<string> {
  const latest = new Map<string, Decree>();
  const later = (a: Decree, b: Decree) =>
    (a.appliedAt ?? 0) - (b.appliedAt ?? 0) ||
    a.votingClosesAt - b.votingClosesAt ||
    a.id.localeCompare(b.id);
  for (const decree of decrees) {
    if (
      decree.status !== 'applied' ||
      (decree.model !== 'market_tax_rate' && decree.model !== 'port_dues')
    )
      continue;
    const current = latest.get(decree.model);
    if (!current || later(decree, current) > 0) latest.set(decree.model, decree);
  }
  return new Set([...latest.values()].map((decree) => decree.id));
}

const range = (min: string, max: string) =>
  z
    .record(z.string(), count)
    .refine((value) => min in value && max in value && (value[min] ?? 0) <= (value[max] ?? 0));
const boundsSchemas = {
  market_tax_rate: range('minRateBps', 'maxRateBps'),
  port_dues: range('minCoefficientBps', 'maxCoefficientBps'),
  public_works: range('minOboles', 'maxOboles'),
  festival: z.object({
    minOboles: count,
    maxOboles: count,
    minDays: count,
    maxDays: count,
    goodIds: z.array(id),
    maxGoods: count,
  }),
};

/** Règles des décrets en vigueur (vue `decree_rules`, une ligne par modèle ouvert). */
export interface DecreeRules {
  bounds: DecreeModelBounds;
  models: DecreeModel[];
  votingDays: number;
  quorumBps: number;
  maxOpenPerCity: number;
  spendingCapShareBps: number;
}

const ruleRow = z.object({
  model: z.string(),
  bounds: z.unknown(),
  voting_days: count,
  quorum_bps: bps,
  max_open_per_city: count,
  spending_cap_share_bps: bps,
});

/**
 * Règles lues ; un modèle inconnu du client est ignoré, des bornes illisibles font échouer la lecture.
 * Aucune ligne : aucun modèle ouvert (`models` vide).
 */
export function parseDecreeRules(rows: unknown): DecreeRules | null {
  const parsed = z.array(ruleRow).safeParse(rows);
  if (!parsed.success) return null;
  const bounds: Record<string, unknown> = {};
  const models: DecreeModel[] = [];
  for (const row of parsed.data) {
    if (!(row.model in boundsSchemas)) continue;
    const model = row.model as DecreeModel;
    const read = boundsSchemas[model].safeParse(row.bounds);
    if (!read.success) return null;
    bounds[model] = read.data;
    models.push(model);
  }
  const first = parsed.data[0];
  return {
    bounds: bounds as DecreeModelBounds,
    models,
    votingDays: first?.voting_days ?? 0,
    quorumBps: first?.quorum_bps ?? 0,
    maxOpenPerCity: first?.max_open_per_city ?? 0,
    spendingCapShareBps: first?.spending_cap_share_bps ?? 0,
  };
}

/**
 * Paramètres saisis jugés par le schéma borné de `@oikos/contracts`, le même que l'API : la proposition
 * s'ils sont tous dans les bornes, et le nom de chaque paramètre fautif, jugé seul. Modèle fermé : rien ne part.
 */
export function checkDecreeParams(bounds: DecreeModelBounds, model: DecreeModel, params: unknown) {
  const parsed = boundedDecreeParamsSchemas(bounds)[model]?.safeParse(params);
  return {
    proposal: parsed?.success ? ({ model, params: parsed.data } as DecreeProposal) : null,
    faulty: new Set((parsed?.error?.issues ?? []).map((issue) => String(issue.path[0]))),
  };
}

/** Lecture des nombres saisis, déplacée dans `@oikos/ui` pour la saisie numérique (`NumberField`). */
export { readTypedNumber, typedIntegerProblem } from '@oikos/ui';
