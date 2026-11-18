import type { Blazon as BlazonValue } from '@oikos/contracts';
import { Amphora, Bird, Leaf, Ship, Sun, Waves, type Icon } from '@oikos/ui';

const EMBLEMS: Record<BlazonValue['emblem'], Icon> = {
  owl: Bird,
  trident: Waves,
  olive: Leaf,
  amphora: Amphora,
  sun: Sun,
  ship: Ship,
};
/** Couleurs de fond : les teintes du thème ; le noir reste noir dans les deux thèmes (figures noires). */
const TINCTURES: Record<BlazonValue['tincture'], string> = {
  terracotta: 'var(--primary)',
  black: '#1c1917',
  ochre: 'var(--accent)',
  aegean: 'var(--aegean)',
};
const SHAPES: Record<BlazonValue['shape'], string> = {
  hoplon: 'M20 2a18 18 0 1 1 0 36 18 18 0 0 1 0-36Z',
  pelte: 'M4 6c10 6 22 6 32 0 0 18-7 28-16 32C11 34 4 24 4 6Z',
  thyreos: 'M20 2c9 0 15 7 15 18s-6 18-15 18S5 31 5 20 11 2 20 2Z',
};

/** Blason d'une maison : forme, couleur et emblème choisis à la fondation. Décoratif, le nom l'accompagne. */
export function Blazon({
  blazon,
  className = 'size-10',
}: {
  blazon: BlazonValue;
  className?: string;
}) {
  const Emblem = EMBLEMS[blazon.emblem];
  return (
    <span
      aria-hidden="true"
      className={`relative inline-grid shrink-0 place-items-center ${className}`}
    >
      <svg viewBox="0 0 40 40" className="absolute inset-0 size-full drop-shadow-sm">
        <path
          d={SHAPES[blazon.shape]}
          fill={TINCTURES[blazon.tincture]}
          stroke="var(--border)"
          strokeWidth="1.5"
        />
      </svg>
      <Emblem
        className={`relative size-[45%] ${blazon.tincture === 'ochre' ? 'text-[#1c1917]' : 'text-white'}`}
        strokeWidth={1.75}
      />
    </span>
  );
}
