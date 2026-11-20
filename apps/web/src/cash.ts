import { useEffect } from 'react';
import { useRows } from './data';

/**
 * Trésorerie de la maison (vue `my_treasury`), relue chaque minute pour qu'une recette survenue pendant
 * qu'un écran reste ouvert y réactive les achats. `null` tant qu'elle n'est pas lue, sans ligne ou illisible.
 */
export function useCash() {
  const treasury = useRows<{ balance: unknown }>('my_treasury', 'balance', 'house_id');
  const { reload } = treasury;
  useEffect(() => {
    const timer = setInterval(() => void reload(), 60_000);
    return () => clearInterval(timer);
  }, [reload]);
  const balance = treasury.rows?.[0]?.balance;
  return { balance: typeof balance === 'number' ? balance : null, reload };
}
