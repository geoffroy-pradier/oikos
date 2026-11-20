import type { ReactNode, SVGProps } from 'react';
import { cn } from '../cn';

/**
 * Un dessin s'écrit ligne à ligne : un code de ton, une espace, un tracé SVG (`d`).
 * Il ne peut contenir que des tracés : ni image, ni lien, ni ressource externe.
 * Le trait est `currentColor` ; les aplats viennent des jetons de `theme.css`, le dessin suit donc le
 * thème. Un dessin n'emploie que deux aplats au plus en plus du trait, hors paysages (cités, accueil).
 */
const TONES: Record<string, SVGProps<SVGPathElement>> = {
  /** Trait seul. */
  '-': {},
  /** Aplat doux, de la famille de l'accent : le corps d'un objet. */
  s: { style: { fill: 'var(--primary-subtle)' } },
  /** Aplat de l'accent décoratif : un détail mis en avant. */
  a: { style: { fill: 'var(--accent-decorative)' } },
  /** Aplat neutre. */
  m: { style: { fill: 'var(--muted)' } },
  /** Accent décoratif, en aplat sans trait. */
  A: { style: { fill: 'var(--accent-decorative)' }, stroke: 'none' },
  /** Aplat doux sans trait : le fond d'un emblème. */
  S: { style: { fill: 'var(--primary-subtle)' }, stroke: 'none' },
  /** Mer sans trait ; trait de côte, pour la seule texture des vagues (il ne porte aucune forme). */
  E: { style: { fill: 'var(--sea)' }, stroke: 'none' },
  c: { style: { stroke: 'var(--coast)' } },
  /** Terre et mer cernées du trait (un houppier, un bassin). */
  t: { style: { fill: 'var(--land)' } },
  e: { style: { fill: 'var(--sea)' } },
  /** Plein de la couleur du trait, sans trait (un œil, un point). */
  I: { fill: 'currentColor', stroke: 'none' },
  /** Trait de l'accent décoratif. */
  l: { style: { stroke: 'var(--accent-decorative)' } },
};

/** Tracés d'un dessin ; un code de ton inconnu est une erreur de dessin. */
export function paths(source: string): ReactNode {
  return source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line)
    .map((line, index) => {
      const [code = '', ...d] = line.split(' ');
      const tone = TONES[code];
      if (!tone) throw new Error(`Ton inconnu : ${code}`);
      return <path key={index} {...tone} d={d.join(' ')} />;
    });
}

/** Cercle en tracé. */
export const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;

/** Ellipse en tracé, tournée de `deg` degrés autour de son centre. */
export function ellipse(cx: number, cy: number, rx: number, ry: number, deg = 0) {
  const [dx, dy] = [rx * Math.cos((deg * Math.PI) / 180), rx * Math.sin((deg * Math.PI) / 180)];
  const arc = (x: number, y: number) => `A${rx} ${ry} ${deg} 1 0 ${x} ${y}`;
  return `M${cx - dx} ${cy - dy}${arc(cx + dx, cy + dy)}${arc(cx - dx, cy - dy)}Z`;
}

/** Dessin d'un identifiant, ou le repli : seules les clés propres comptent (pas `constructor`). */
export function drawing(drawings: Record<string, string>, id: string, fallback: string) {
  return paths(Object.hasOwn(drawings, id) ? (drawings[id] ?? fallback) : fallback);
}

export interface IllustrationProps {
  /** Nom accessible : sans lui, l'illustration est décorative (`aria-hidden`). */
  label?: string;
  className?: string;
}

interface SvgProps extends IllustrationProps {
  viewBox: string;
  width: number;
  height: number;
  strokeWidth?: number;
  children: ReactNode;
}

/** Cadre commun : trait rond de la couleur du texte, aucun remplissage par défaut. */
export function Svg({
  viewBox,
  width,
  height,
  strokeWidth = 2,
  label,
  className,
  children,
}: SvgProps) {
  const a11y = label
    ? ({ role: 'img', 'aria-label': label } as const)
    : ({ 'aria-hidden': true } as const);
  return (
    <svg
      viewBox={viewBox}
      width={width}
      height={height}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      className={cn('shrink-0', className)}
      {...a11y}
    >
      {children}
    </svg>
  );
}
