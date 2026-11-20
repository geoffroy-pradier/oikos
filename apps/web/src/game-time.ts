import { useEffect, useState } from 'react';
import { serverClock, syncServerClock } from './server-clock';

/**
 * Date et heure d'un instant (un message, une récolte, une arrivée) : un seul format sur tous les écrans du jeu
 * qui en montrent, Messages compris (#869).
 */
export const dateTimeFormat = (language: string) =>
  new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'short' });

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

/** Heure et minute d'un instant, dans la langue de l'interface et le fuseau de l'appareil. */
export const formatTime = (language: string, at: Date) =>
  new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }).format(at);
