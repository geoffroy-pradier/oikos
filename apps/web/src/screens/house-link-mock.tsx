import type { ReactNode } from 'react';

/**
 * Simulation de `HouseLink` pour les tests d'écrans qui rendent des liens vers une fiche sans routeur : un lien
 * simple, de même classe. La navigation vers la fiche a son test (`HouseProfile.test.tsx`, bout en bout).
 * Usage : `vi.mock('./HouseLink', () => import('./house-link-mock'))`.
 */
export const HouseLink = ({
  houseId,
  children,
  className = '',
}: {
  houseId: string;
  children: ReactNode;
  className?: string;
}) => (
  <a href={`/maison/${houseId}`} className={`font-semibold ${className}`}>
    {children}
  </a>
);
