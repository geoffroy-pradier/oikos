import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

/** Lien vers la fiche publique d'une maison (6.6) : le nom d'une maison citée, ou ce qui la désigne. */
export function HouseLink({
  houseId,
  children,
  className = '',
}: {
  houseId: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      to="/maison/$houseId"
      params={{ houseId }}
      className={`rounded-sm font-semibold text-primary underline underline-offset-4 ${className}`}
    >
      {children}
    </Link>
  );
}
