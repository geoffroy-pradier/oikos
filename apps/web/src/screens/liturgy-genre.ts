import type { LiturgyGenre } from '@oikos/contracts';
import { Drama, type Icon, PartyPopper, Ship } from '@oikos/ui';

/** Icône au trait de chaque genre de liturgie (6.4) : la fête, le navire d'escorte (triérarchie) et le chœur (chorégie). */
export const GENRE_ICONS: Record<LiturgyGenre, Icon> = {
  festival: PartyPopper,
  trierarchy: Ship,
  choregia: Drama,
};
