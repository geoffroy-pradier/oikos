import { useEffect, useState } from 'react';
import { serverClock, syncServerClock } from './server-clock';

/**
 * Heure de jeu : celle du serveur (l'horloge du navigateur peut être fausse), lue à l'ouverture puis à
 * chaque minute pleine et au retour sur l'onglet, où la minuterie a pu être ralentie.
 */
export function useGameTime(): Date {
  const [now, setNow] = useState(() => serverClock.now());
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      clearTimeout(timer);
      if (!live) return;
      const at = serverClock.now();
      setNow(at);
      timer = setTimeout(tick, 60_000 - (at.getTime() % 60_000));
    };
    void syncServerClock().then(tick);
    tick();
    document.addEventListener('visibilitychange', tick);
    return () => {
      live = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  return now;
}
