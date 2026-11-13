import { createContext, useContext } from 'react';

export interface HouseSummary {
  name: string;
  cityName: string;
  citizenshipStatus: 'metic' | 'citizen';
}

const HouseContext = createContext<HouseSummary | null>(null);
export const HouseProvider = HouseContext.Provider;

/** Maison du joueur connecté. N'est appelé que sous la coquille, donc après la création de la maison. */
export function useHouse(): HouseSummary {
  const house = useContext(HouseContext);
  if (!house) throw new Error('useHouse must be used inside the shell');
  return house;
}
