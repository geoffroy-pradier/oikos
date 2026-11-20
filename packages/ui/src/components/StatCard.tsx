import {
  Children,
  cloneElement,
  isValidElement,
  type CSSProperties,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cn } from '../cn';
import { Card } from './Card';

/** Forme d'une `Card` posée, pour la carte qui ne peut pas être une `section` (`definition`). */
const CARD = 'rounded-xl border border-border-subtle bg-surface p-4 text-foreground shadow-sm';

const GLYPHS = { up: '▲', down: '▼', flat: '–' } as const;
const TONES = {
  positive: 'text-success',
  negative: 'text-danger',
  neutral: 'text-muted-foreground',
} as const;

/**
 * Valeur sur une ligne : sa taille suit la largeur de la carte (`cqi`) et la largeur de son texte, jusqu'à 1,75 rem
 * (1,25 rem pour une petite carte sous 1 024 px).
 */
const FIT = 'text-[length:min(var(--stat-max),100cqi/var(--stat-em))]';
/** Largeur des caractères d'Inter grasse en chiffres tabulaires, en em, arrondie au-dessus ; 0,65 pour les autres. */
const EM: [string, number][] = [
  ['\u202f', 0.14],
  [' \u00a0,.;:', 0.27],
  ['ijlîI', 0.28],
  ["frt()/'’", 0.41],
  ['–', 0.5],
  ['abcdeghknopqsuvxyzàâçéèêôûù', 0.64],
  ['ABCDEFGHJKLNOPQRSTUVXYZ', 0.78],
  ['mM', 0.94],
  ['—%', 1.02],
  ['wW', 1.04],
];
/** Largeur d'une valeur en em, ou 0 si ce n'est pas un texte. */
function emOf(value: ReactNode) {
  if (typeof value !== 'string' && typeof value !== 'number') return 0;
  return [...`${value}`].reduce(
    (sum, char) => sum + (EM.find(([chars]) => chars.includes(char))?.[1] ?? 0.65),
    0,
  );
}
/**
 * Largeur (em) au-delà de laquelle une valeur fait de sa carte une carte large dans une `StatGrid` : sous 1 280 px,
 * ce qu'une colonne de deux garde à pleine taille (« 0 obole », « 1 sur 4 ») ; au-delà, ce qu'en garde une colonne
 * de quatre (« 9 drachmes »).
 */
const FULL_EM = { two: 4.5, four: 7 };
export interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  /** Icône décorative, à droite du libellé. */
  icon?: ReactNode;
  /**
   * Variation, déjà formatée et signée (« +4,2 % »). Le triangle double le sens par la forme, jamais
   * la couleur seule ; le ton dit si elle est bonne (une charge qui monte est `negative`).
   */
  delta?: { value: ReactNode; trend: keyof typeof GLYPHS; tone?: keyof typeof TONES } | undefined;
  /** Précision après la variation (« depuis hier »), sur la seule ligne secondaire de la carte. */
  hint?: ReactNode;
  /** Petit graphique décoratif, à droite de la ligne secondaire. */
  chart?: ReactNode;
  /** Petite carte sous 1 024 px : libellé et valeur seuls, plus petite, sans icône ni ligne secondaire. */
  dense?: boolean;
  /** Carte large : deux colonnes d'une `StatGrid` (qui la lit), pour le chiffre principal d'un écran. */
  wide?: boolean | undefined;
  /** Plan inversé sous 1 024 px (jetons `inverse`) : la carte mise en tête du tableau de bord. */
  inverse?: boolean;
  /**
   * Carte placée dans une liste de définitions (`dl`), où une suite de chiffres se lit comme des paires : la
   * carte est un `div`, le libellé un `dt` (son texte en enfant direct), la valeur et la variation des `dd`.
   */
  definition?: boolean;
  className?: string | undefined;
}

/**
 * Chiffre clé en carte : libellé atténué et icône, valeur en grand sur une ligne, en chiffres tabulaires, puis une
 * ligne secondaire (variation, précision). Dans une `StatGrid`, libellés, valeurs et lignes secondaires d'une rangée
 * s'alignent : un libellé sur deux lignes ne décale pas la valeur.
 */
export function StatCard({
  label,
  value,
  icon,
  delta,
  hint,
  chart,
  dense,
  inverse,
  definition,
  className,
}: StatCardProps) {
  const tone =
    delta?.tone ??
    (delta?.trend === 'up' ? 'positive' : delta?.trend === 'down' ? 'negative' : 'neutral');
  const em = emOf(value);
  const [Label, Value] = definition ? (['dt', 'dd'] as const) : (['div', 'p'] as const);
  const muted = cn('text-muted-foreground', inverse && 'max-lg:text-inverse-muted');
  const secondary = (
    <>
      {delta && (
        <span
          data-trend={delta.trend}
          className={cn(
            'font-semibold tabular-nums',
            TONES[tone],
            inverse && 'max-lg:text-inverse-foreground',
          )}
        >
          <span aria-hidden="true">{GLYPHS[delta.trend]} </span>
          {delta.value}
        </span>
      )}
      {delta && hint && ' '}
      {hint}
    </>
  );
  const body = (
    <>
      <Label
        className={cn(
          'flex items-start justify-between gap-2 text-[0.8125rem]',
          muted,
          dense && 'max-lg:text-xs',
        )}
      >
        {definition ? label : <span>{label}</span>}
        {icon && (
          <span aria-hidden="true" className={cn('[&_svg]:size-4', dense && 'max-lg:hidden')}>
            {icon}
          </span>
        )}
      </Label>
      {/* Conteneur de la valeur (`cqi`) : la carte ne peut pas l'être, ses rangées partagées s'y perdraient. Une
          valeur rapetissée se pose au bas de sa rangée, sur la ligne de ses voisines. */}
      <Value className="@container self-end">
        <span
          data-stat-value=""
          style={em ? ({ '--stat-em': em.toFixed(2) } as CSSProperties) : undefined}
          className={cn(
            'block text-[length:var(--stat-max)] leading-tight font-bold whitespace-nowrap tabular-nums',
            '[--stat-max:1.75rem]',
            dense && 'max-lg:[--stat-max:1.25rem]',
            em > 0 && FIT,
          )}
        >
          {value}
        </span>
      </Value>
      {(delta || hint || chart) && (
        <Value
          className={cn(
            'text-[0.8125rem]',
            chart && 'flex items-end justify-between gap-3',
            muted,
            dense && 'max-lg:hidden',
          )}
        >
          {chart ? (
            <>
              <span className="min-w-0">{secondary}</span>
              {chart}
            </>
          ) : (
            secondary
          )}
        </Value>
      )}
    </>
  );
  const frame = cn(
    'grid content-start gap-1.5',
    dense && 'max-lg:gap-1 max-lg:p-3',
    inverse &&
      'max-lg:rounded-2xl max-lg:border-inverse max-lg:bg-inverse max-lg:text-inverse-foreground',
    className,
  );
  return definition ? (
    <div data-stat-card="" className={cn(CARD, frame)}>
      {body}
    </div>
  ) : (
    <Card data-stat-card="" className={frame}>
      {body}
    </Card>
  );
}

export interface StatGridProps extends HTMLAttributes<HTMLElement> {
  /** `ul` quand chaque carte est dans un `li`, `dl` pour des cartes `definition`. */
  as?: 'div' | 'section' | 'ul' | 'dl';
}

/** La `StatCard` d'un enfant de la grille, posée seule ou dans un `li`. */
function cardIn(node: ReactNode): StatCardProps | null {
  if (!isValidElement<{ children?: ReactNode }>(node)) return null;
  if (node.type === StatCard) return node.props as StatCardProps;
  return Children.count(node.props.children) === 1 ? cardIn(node.props.children) : null;
}

const XL_COLUMNS =
  ' xl:grid-cols-1 xl:grid-cols-2 xl:grid-cols-3 xl:grid-cols-4 xl:grid-cols-5'.split(' ');

/**
 * Grille commune des cartes de chiffres, dans le jeu comme dans Olympe : deux colonnes, puis, à partir de
 * 1 280 px, une seule rangée si les cartes tiennent en cinq colonnes (une carte large en compte deux), où toutes les
 * valeurs ont la même taille, quatre colonnes sinon. Chaque carte occupe
 * trois rangées de la grille (libellé, valeur, ligne secondaire) qu'elle partage avec ses voisines. Une carte large
 * (`wide`, ou valeur trop longue pour une colonne) en prend deux : une rangée garde des chiffres de même taille.
 * Sous 1 280 px, une carte restée seule sur sa rangée la prend entière.
 */
export function StatGrid({ as: Tag = 'div', className, style, children, ...props }: StatGridProps) {
  const items = Children.toArray(children);
  const cards = items.map(cardIn);
  const span = (i: number, full: number) => {
    const card = cards[i];
    return card ? (card.wide || emOf(card.value) > full ? 2 : 1) : 0;
  };
  // À partir de 1 280 px : une seule rangée si les cartes tiennent en cinq colonnes.
  const columns = items.reduce<number>((sum, _, i) => sum + span(i, FULL_EM.four), 0);
  const row = columns <= 5;
  // Dans cette rangée, toutes les valeurs prennent la taille de la plus serrée (cqi : largeur de la grille ; carte :
  // marge de 1 rem et bordure de 1 px de chaque côté ; colonnes séparées de 1 rem).
  const tightest = new Map<number, number>();
  cards.forEach((card, i) => {
    const em = card ? emOf(card.value) : 0;
    if (em)
      tightest.set(span(i, FULL_EM.four), Math.max(em, tightest.get(span(i, FULL_EM.four)) ?? 0));
  });
  const fit = [...tightest].map(
    ([wide, em]) =>
      `calc((${wide} * (100cqi - ${columns - 1}rem) / ${columns} + ${wide - 1}rem - 2rem - 2px) / ${em.toFixed(2)})`,
  );
  // Sous 1 280 px, deux colonnes : une carte d'une colonne est seule quand la suivante est large ou absente.
  // Ce qui n'est pas une carte prend sa rangée.
  const alone = new Set<number>();
  let [column, last] = [0, -1];
  items.forEach((_, i) => {
    if (span(i, FULL_EM.two) === 1) [column, last] = [1 - column, i];
    else {
      if (column === 1) alone.add(last);
      column = 0;
    }
  });
  if (column === 1) alone.add(last);
  const classes = (i: number) =>
    cn(
      (span(i, FULL_EM.two) === 2 || alone.has(i)) && 'max-xl:col-span-2',
      span(i, FULL_EM.four) === 2 && 'xl:col-span-2',
    );
  return (
    <Tag
      className={cn(
        'grid grid-cols-2 gap-2 sm:gap-3 xl:gap-4',
        row ? XL_COLUMNS[columns] : 'xl:grid-cols-4',
        row &&
          fit.length > 0 &&
          cn(
            '@container xl:[&_[data-stat-card]]:[--stat-row:var(--stat-fit)]',
            'xl:[&_[data-stat-value]]:text-[length:var(--stat-row)]',
          ),
        '[&>li]:row-span-3 [&>li]:grid [&>li]:grid-rows-subgrid',
        '[&_[data-stat-card]]:row-span-3 [&_[data-stat-card]]:grid-rows-subgrid',
        className,
      )}
      style={
        row && fit.length > 0
          ? ({ ...style, '--stat-fit': `min(1.75rem, ${fit.join(', ')})` } as CSSProperties)
          : style
      }
      {...props}
    >
      {items.map((item, i) =>
        classes(i) && isValidElement<{ className?: string }>(item)
          ? cloneElement(item as ReactElement<{ className?: string }>, {
              className: cn(item.props.className, classes(i)),
            })
          : item,
      )}
    </Tag>
  );
}
