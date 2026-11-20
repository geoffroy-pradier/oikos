import { circle, Svg, type IllustrationProps } from './svg';

/**
 * Côte passant par des points placés à la main : chaque segment est découpé tous les 14 environ et ses
 * points intermédiaires sont écartés d'un bruit fixe (même dessin à chaque rendu), puis le tout est lissé
 * (Catmull-Rom en courbes de Bézier) et fermé. Les points hors du cadre ferment un continent sans se voir.
 */
function coast(source: string, index: number): string {
  const hand = source.split(',').map((pair) => pair.trim().split(' ').map(Number));
  const points: number[][] = [];
  hand.forEach(([ax = 0, ay = 0], i) => {
    const [bx = 0, by = 0] = hand[(i + 1) % hand.length] ?? [];
    const length = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.round(length / 14));
    for (let k = 0; k < steps; k += 1) {
      const noise =
        k === 0 ? 0 : Math.sin(index * 97.3 + i * 12.9 + k * 4.7) * Math.min(6, length / 10);
      const t = k / steps;
      points.push([
        ax + (bx - ax) * t - ((by - ay) / length) * noise,
        ay + (by - ay) * t + ((bx - ax) / length) * noise,
      ]);
    }
  });
  const at = (i: number) => points[(i + points.length) % points.length] ?? [0, 0];
  const r = (n = 0) => Math.round(n * 10) / 10;
  let d = `M${r(at(0)[0])} ${r(at(0)[1])}`;
  for (let i = 0; i < points.length; i += 1) {
    const [[ax = 0, ay = 0], [bx = 0, by = 0], [cx = 0, cy = 0], [dx = 0, dy = 0]] = [
      at(i - 1),
      at(i),
      at(i + 1),
      at(i + 2),
    ];
    d += `C${r(bx + (cx - ax) / 6)} ${r(by + (cy - ay) / 6)} ${r(cx - (dx - bx) / 6)} ${r(cy - (dy - by) / 6)} ${r(cx)} ${r(cy)}`;
  }
  return `${d}Z`;
}

/**
 * Les terres de l'archipel, 1 000 × 700 : un continent au nord-ouest, un autre à l'est, les douze îles
 * des cités (Kallistè au centre, Elaia au nord-est, Ampelos à l'ouest, Halos au sud-est, puis les huit de
 * #707 autour d'elles) et des îlots.
 * Les cités se posent sur leur île par `CITY_MAP_POSITIONS` (`@oikos/config/client`).
 */
const LANDS: readonly string[] = [
  // Continent du nord-ouest : une côte découpée, un golfe et le cap qui s'avance vers Ampelos.
  `-40 -40, 520 -40, 505 8, 478 30, 468 62, 440 74, 418 70, 398 92, 402 120, 380 140,
   350 138, 330 152, 326 182, 338 210, 322 236, 300 232, 288 208, 268 196, 240 206,
   214 232, 186 244, 150 256, 124 262, 106 286, 76 296, 56 320, 28 330, 8 352, -40 360`,
  // Continent de l'est.
  `1040 200, 1000 214, 972 232, 958 260, 936 276, 930 304, 910 322, 914 352,
   932 368, 946 392, 958 420, 968 452, 972 482, 966 512, 952 540, 934 558,
   916 576, 904 598, 916 622, 932 648, 926 676, 940 720, 1040 740`,
  // Kallistè, son port au fond de la baie nord, un cap à l'est et une pointe au sud.
  `418 398, 426 370, 444 350, 466 340, 480 346, 488 358, 498 354, 508 342, 522 330, 546 318,
   572 320, 590 332, 596 350, 612 356, 626 348, 632 362, 618 378, 604 392, 606 412, 594 428,
   572 430, 556 444, 546 456, 534 454, 528 444, 510 446, 488 438, 462 444, 440 432, 424 418`,
  // Elaia, longue crête d'oliviers, sa côte sud échancrée.
  `706 204, 710 184, 726 170, 744 160, 756 142, 774 128, 796 116, 818 104, 842 102, 862 110,
   870 124, 860 138, 844 144, 838 160, 822 172, 812 190, 794 200, 782 214, 762 218, 746 226,
   726 226, 712 218`,
  // Ampelos, coteaux tournés vers l'est, une presqu'île au sud-ouest.
  `146 416, 140 398, 150 380, 166 370, 178 352, 198 344, 222 346, 240 356, 262 364, 280 370,
   298 384, 302 402, 290 414, 272 420, 262 438, 246 456, 222 470, 200 466, 190 450, 176 444,
   160 448, 148 436`,
  // Halos, l'anse de ses salines au sud.
  `676 540, 682 516, 700 502, 722 504, 742 490, 768 486, 794 494, 816 502, 832 520, 834 540,
   820 556, 826 574, 814 590, 792 588, 776 600, 756 606, 744 596, 752 580, 736 572, 718 586,
   700 584, 688 566`,
  // Delphis, sous son mont : les pèlerins mouillent au fond de la baie du sud.
  `540 96, 548 80, 566 72, 580 60, 600 54, 622 58, 640 52, 660 58, 672 72, 668 88, 654 96,
   650 112, 636 124, 618 126, 606 116, 596 104, 584 112, 570 120, 552 116`,
  // Dikaia, au débouché du golfe, haute île au cap tourné vers Kallistè.
  `380 220, 386 200, 402 188, 418 192, 434 180, 454 178, 470 190, 468 206, 478 220, 494 232,
   488 242, 470 240, 456 252, 438 262, 418 258, 404 246, 388 240`,
  // Emporion, le carrefour entre Kallistè, Elaia et Halos, aux deux anses.
  `656 348, 660 330, 674 322, 680 310, 696 306, 712 316, 724 332, 720 346, 728 362, 716 374,
   700 370, 688 380, 672 374, 662 362`,
  // Agrotera, l'île boisée de l'ouest.
  `36 486, 40 462, 54 444, 72 436, 84 424, 102 426, 118 440, 124 460, 116 476, 126 494,
   118 512, 100 520, 86 512, 70 522, 52 516, 40 502`,
  // Phrourion, rocher fortifié du sud-ouest, son port au nord.
  `190 604, 198 588, 214 580, 232 586, 244 572, 262 570, 274 582, 292 576, 312 584, 318 600,
   306 610, 312 626, 300 640, 278 646, 262 658, 244 650, 222 652, 204 640, 196 624`,
  // Myrrhinè, en croissant autour de sa baie d'écume.
  `404 600, 408 578, 424 562, 446 552, 470 554, 492 566, 504 584, 488 590, 472 584, 460 596,
   470 610, 494 614, 486 630, 464 638, 440 636, 418 626`,
  // Chalkeia, le volcan du sud, sa coulée en cap vers l'est.
  `558 656, 562 634, 578 620, 598 612, 620 614, 640 624, 654 640, 668 652, 660 664, 644 668,
   632 684, 608 692, 584 688, 566 676`,
  // Gamelia, longue île détachée de la côte de l'est par un détroit.
  `836 492, 842 474, 858 462, 870 446, 888 434, 908 430, 926 440, 930 456, 918 466, 912 482,
   900 496, 884 504, 866 516, 848 514`,
  // Îlots.
  `548 520, 560 512, 574 518, 570 532, 554 534`,
  `330 520, 342 512, 356 518, 352 532, 336 534`,
  `700 640, 712 632, 726 638, 722 652, 706 654`,
];

/** Hauteurs : un aplat léger au cœur des terres (le mont de Kallistè, la crête d'Elaia, les arrière-pays). */
const HEIGHTS: readonly string[] = [
  '-40 -40, 380 -40, 360 40, 300 80, 200 130, 100 180, -40 230',
  '1040 300, 980 360, 992 450, 988 540, 1040 620',
  '520 368, 548 352, 576 356, 584 376, 566 394, 538 398, 520 388',
  '744 190, 780 160, 820 132, 840 124, 832 140, 798 170, 764 198',
  '186 400, 206 378, 232 376, 240 396, 222 414, 198 418',
  // Le mont de Delphis, le pic de Dikaia, les bois d'Agrotera, le volcan de Chalkeia, la citadelle de Phrourion.
  '600 68, 620 62, 640 64, 646 78, 630 86, 610 84',
  '414 206, 430 194, 448 192, 452 206, 436 216',
  '58 470, 74 450, 98 446, 108 462, 92 480, 70 486',
  '586 644, 598 630, 614 632, 620 646, 606 656, 592 656',
  '236 596, 254 588, 270 594, 266 608, 246 610',
];

/** Quadrillage très discret, tous les 100. */
const GRID =
  Array.from({ length: 9 }, (_, i) => `M${(i + 1) * 100} 0V700`).join('') +
  Array.from({ length: 6 }, (_, i) => `M0 ${(i + 1) * 100}H1000`).join('');

/** Quelques vagues en pleine mer, loin des routes et des noms. */
const WAVES = '720 40, 300 290, 600 250, 360 470, 950 60, 150 590, 360 680'
  .split(', ')
  .map((at) => `M${at}c6-5 12-5 18 0s12 5 18 0`)
  .join('');

/** Rose des vents, en bas à gauche : la pointe nord pleine, la lettre N au-dessus. */
const ROSE = {
  ring: circle(78, 618, 22),
  north: 'M78 580L84 612L78 618L72 612Z',
  arms: 'M78 656L84 624L78 618L72 624ZM116 618L84 612L78 618L84 624ZM40 618L72 612L78 618L72 624Z',
  letter: 'M73 572V560L83 572V560',
};

export const ARCHIPELAGO_WIDTH = 1000;
export const ARCHIPELAGO_HEIGHT = 700;

/**
 * L'archipel d'OIKOS, dessiné à la main (ADR 0011) : mer et quadrillage, hauts-fonds autour des terres,
 * côtes, vagues et rose des vents, aux jetons de la carte (`--sea`, `--shoal`, `--land`, `--coast`).
 * Fond de l'onglet Carte : les routes, les navires et les cités s'y posent par-dessus. `width` et
 * `height` le placent dans le repère de l'appelant.
 */
export function Archipelago({
  width = ARCHIPELAGO_WIDTH,
  height = ARCHIPELAGO_HEIGHT,
  ...props
}: IllustrationProps & { width?: number; height?: number }) {
  const lands = LANDS.map(coast).join('');
  return (
    <Svg viewBox="0 0 1000 700" width={width} height={height} strokeWidth={1.5} {...props}>
      <path style={{ fill: 'var(--sea)' }} stroke="none" d="M0 0H1000V700H0Z" />
      <path style={{ stroke: 'var(--coast)' }} strokeWidth={1} opacity={0.35} d={GRID} />
      <path style={{ stroke: 'var(--coast)' }} opacity={0.6} d={WAVES} />
      {/* Hauts-fonds : la côte tracée large, trois anneaux qui pâlissent vers le large. */}
      <path style={{ stroke: 'var(--shoal)' }} strokeWidth={44} opacity={0.3} d={lands} />
      <path style={{ stroke: 'var(--shoal)' }} strokeWidth={28} opacity={0.5} d={lands} />
      <path style={{ stroke: 'var(--shoal)' }} strokeWidth={12} d={lands} />
      <path style={{ fill: 'var(--land)', stroke: 'var(--coast)' }} d={lands} />
      <path
        style={{ fill: 'var(--coast)' }}
        stroke="none"
        opacity={0.22}
        d={HEIGHTS.map((source, i) => coast(source, i + LANDS.length)).join('')}
      />
      <g style={{ stroke: 'var(--muted-foreground)' }}>
        <path d={ROSE.ring} opacity={0.6} />
        <path d={ROSE.arms} style={{ fill: 'var(--sea)' }} />
        <path d={ROSE.north} style={{ fill: 'var(--muted-foreground)' }} />
        <path d={ROSE.letter} strokeWidth={2} />
      </g>
    </Svg>
  );
}
