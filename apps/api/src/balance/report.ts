import type { DayMeasure } from './measures';

/*
 * Rapport du simulateur d'équilibrage (#284, docs/specs/15-back-office-olympe.md 15.1 et 15.2) : les
 * indicateurs d'une partie du banc, ceux de la référence et ceux de la candidate, et l'écart de chacun.
 * Module pur, sans entrée-sortie : il lit les mesures de `measureDay` et ne décide d'aucun chiffre du jeu.
 */

/** Indicateurs d'une partie, à plat : `groupe/clé` vers une valeur entière, ou null quand elle n'existe pas. */
export type Indicators = Record<string, number | null>;

/** Groupes d'indicateurs, dans l'ordre du tableau Markdown. */
export const GROUPS = ['inflation', 'supply', 'flow', 'coverage', 'population', 'margin'] as const;
export type Group = (typeof GROUPS)[number];

/** Groupes dont une clé absente d'un côté vaut zéro (un robinet ou un puits qui n'a pas servi) et non « inconnue ». */
const ZERO_WHEN_ABSENT: readonly Group[] = ['flow'];

/** Titres du rapport Markdown. */
export const LABELS = {
  title: 'Rapport du simulateur d’équilibrage',
  seed: 'Graine',
  days: 'Jours mesurés',
  indicator: 'Indicateur',
  reference: 'Référence',
  candidate: 'Candidate',
  delta: 'Écart',
  deltaPercent: 'Écart (%)',
  none: 'n/d',
  groups: {
    inflation: 'Inflation du panier (points de base, début à fin de période)',
    supply: 'Masse monétaire (oboles, dernier jour)',
    flow: 'Net des robinets (+) et des puits (−) sur la période (oboles)',
    coverage: 'Couverture des besoins vitaux (points de base, dernier jour)',
    population: 'Population (dernier jour)',
    margin: 'Marge nette quotidienne par filière (oboles)',
  } satisfies Record<Group, string>,
};

const key = (group: Group, ...parts: string[]) => `${group}/${parts.join('/')}`;
const mean = (values: readonly number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * Inflation d'une cité (ou du monde) en points de base : variation du coût moyen du panier entre les premiers et les
 * derniers jours de la période, sur des fenêtres d'au plus `window` jours qui ne se recouvrent pas ; null quand une
 * des deux fenêtres n'a aucun échange.
 */
export function inflationBps(days: readonly DayMeasure[], slug: string, window: number) {
  const size = Math.min(window, Math.floor(days.length / 2));
  if (size < 1) return null;
  const costs = (part: readonly DayMeasure[]) =>
    part.flatMap((day) => {
      const cost = day.basket[slug];
      return cost === null || cost === undefined ? [] : [cost];
    });
  const [first, last] = [costs(days.slice(0, size)), costs(days.slice(-size))];
  if (first.length === 0 || last.length === 0) return null;
  const before = mean(first);
  return before === 0 ? null : Math.round(((mean(last) - before) * 10_000) / before);
}

/** Indicateurs d'une partie : `days` sont ses jours mesurés, `margins` les marges de `recipeMargins`. */
export function indicatorsOf(
  days: readonly DayMeasure[],
  margins: Record<string, Record<string, number>>,
  slugs: readonly string[],
  window: number,
): Indicators {
  const out: Indicators = {};
  const last = days.at(-1);
  for (const slug of [...slugs, 'world']) {
    out[key('supply', slug)] = last?.supply[slug] ?? null;
    const nets = new Map<string, number>();
    for (const day of days)
      for (const [system, net] of Object.entries(day.flows[slug] ?? {}))
        nets.set(system, (nets.get(system) ?? 0) + net);
    for (const [system, net] of nets) out[key('flow', slug, system)] = net;
  }
  // Le panier de l'indice est celui d'une cité : le monde n'a pas d'inflation propre.
  for (const slug of slugs) {
    out[key('inflation', slug)] = inflationBps(days, slug, window);
    out[key('population', slug)] = last?.population[slug] ?? null;
    for (const [classId, bps] of Object.entries(last?.coverage[slug] ?? {}))
      out[key('coverage', slug, classId)] = bps;
    for (const [recipeId, margin] of Object.entries(margins[slug] ?? {}))
      out[key('margin', slug, recipeId)] = margin;
  }
  return out;
}

/** Rapport : les indicateurs des deux parties et l'écart de chacun (candidate moins référence). */
export interface Report {
  seed: string;
  days: number;
  reference: Indicators;
  candidate: Indicators;
  /** Écart absolu, null quand un des deux côtés n'a pas la valeur. */
  deltas: Indicators;
  /** Écart en pourcentage de la référence (un chiffre après la virgule) ; null sans référence ou à référence nulle. */
  deltaPercents: Indicators;
}

const groupOf = (name: string) => name.slice(0, name.indexOf('/')) as Group;

/** Compare une candidate à la référence, indicateur par indicateur (l'union des deux ensembles de clés). */
export function compare(
  reference: Indicators,
  candidate: Indicators,
  meta: { seed: string; days: number },
): Report {
  const names = [...new Set([...Object.keys(reference), ...Object.keys(candidate)])].sort(
    (a, b) => GROUPS.indexOf(groupOf(a)) - GROUPS.indexOf(groupOf(b)) || a.localeCompare(b),
  );
  const read = (side: Indicators, name: string) =>
    side[name] ?? (ZERO_WHEN_ABSENT.includes(groupOf(name)) && !(name in side) ? 0 : null);
  const [ref, cand, deltas, deltaPercents]: [Indicators, Indicators, Indicators, Indicators] = [
    {},
    {},
    {},
    {},
  ];
  for (const name of names) {
    const [before, after] = [read(reference, name), read(candidate, name)];
    ref[name] = before;
    cand[name] = after;
    deltas[name] = before === null || after === null ? null : after - before;
    deltaPercents[name] =
      before === null || after === null || before === 0
        ? null
        : Math.round(((after - before) * 1000) / Math.abs(before)) / 10;
  }
  return { ...meta, reference: ref, candidate: cand, deltas, deltaPercents };
}

const cell = (value: number | null) => (value === null ? LABELS.none : String(value));
const signed = (value: number | null) =>
  value === null ? LABELS.none : value > 0 ? `+${value}` : String(value);

/** Rapport en tableaux Markdown, un par groupe d'indicateurs. */
export function toMarkdown(report: Report): string {
  const lines = [
    `# ${LABELS.title}`,
    '',
    `${LABELS.seed} : \`${report.seed}\``,
    `${LABELS.days} : ${report.days}`,
  ];
  for (const group of GROUPS) {
    const names = Object.keys(report.reference).filter((name) => groupOf(name) === group);
    if (names.length === 0) continue;
    lines.push(
      '',
      `## ${LABELS.groups[group]}`,
      '',
      `| ${LABELS.indicator} | ${LABELS.reference} | ${LABELS.candidate} | ${LABELS.delta} | ${LABELS.deltaPercent} |`,
      '| --- | ---: | ---: | ---: | ---: |',
    );
    for (const name of names)
      lines.push(
        `| ${name.slice(group.length + 1)} | ${cell(report.reference[name] ?? null)} | ${cell(report.candidate[name] ?? null)} | ${signed(report.deltas[name] ?? null)} | ${signed(report.deltaPercents[name] ?? null)} |`,
      );
  }
  return `${lines.join('\n')}\n`;
}
