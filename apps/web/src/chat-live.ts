import { CLIENT_SETTINGS } from '@oikos/config/client';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

/** Événement que la base diffuse pour chaque message validé (ADR 0008). */
export const MESSAGE_POSTED = 'message_posted';

/**
 * Sujets à écouter pour une maison : le canal de sa cité, et le sujet de la maison, où arrivent les messages
 * de toutes ses conversations privées (ADR 0008). `null` tant que le canal de la cité n'est pas lu.
 */
export const chatTopics = (cityChannelId: string | null, houseId: string) =>
  cityChannelId === null ? null : [`chat:${cityChannelId}`, `house:${houseId}`];

/** Retraits d'abonnement en cours, par sujet. */
const closing = new Map<string, Promise<undefined>>();

/**
 * `connecting` : abonnements en cours ; `live` : tous établis, les messages arrivent en direct ;
 * `polling` : un abonnement est refusé, a expiré ou est tombé, l'écran relit à intervalle régulier.
 */
export type LiveState = 'connecting' | 'live' | 'polling';

/**
 * Écoute les sujets donnés en canaux privés de Realtime et appelle `onSignal` à chaque message diffusé, avec le
 * canal que la diffusion nomme. La diffusion ne porte que des identifiants : `onSignal` relit les messages par
 * les vues, sous règles par ligne, si bien qu'une diffusion forgée ne fait que relire. `onSignal` sans canal :
 * tout relire. Il est appelé ainsi :
 * - chaque fois que tous les abonnements sont établis, la première fois comprise : un message validé entre la
 *   première lecture et l'abonnement n'a été diffusé à personne ;
 * - tant qu'un abonnement n'est pas établi après un échec, ou à la première échéance sans réponse, toutes les
 *   `CLIENT_SETTINGS.chatPollSeconds` secondes, onglet visible ;
 * - en direct, toutes les `CLIENT_SETTINGS.chatSafetyRereadSeconds` secondes, onglet visible, contre une
 *   diffusion qui tomberait en panne sans que l'abonnement le sache ;
 * - au retour sur l'onglet.
 */
export function useChatLive(
  topics: readonly string[] | null,
  onSignal: (channelId?: string) => void,
): LiveState {
  const [state, setState] = useState<LiveState>('connecting');
  const signal = useRef(onSignal);
  signal.current = onSignal;
  const key = topics === null ? null : JSON.stringify(topics);

  useEffect(() => {
    if (key === null) return;
    const names = JSON.parse(key) as string[];
    const statuses = new Map<string, string>();
    let polling = false;
    let wasLive = false;
    let live = true;
    const subscribed = () => names.every((name) => statuses.get(name) === 'SUBSCRIBED');
    const show = () => setState(subscribed() ? 'live' : polling ? 'polling' : 'connecting');
    const onStatus = (name: string, status: string) => {
      if (!live) return;
      statuses.set(name, status);
      const now = subscribed();
      // Direct établi ou rétabli : on rattrape ce qui a été validé avant l'abonnement ou pendant la panne.
      if (now && !wasLive) signal.current();
      wasLive = now;
      if (now) polling = false;
      else if (status !== 'SUBSCRIBED') polling = true;
      show();
    };
    setState('connecting');
    // `supabase.channel` rend le canal existant d'un même sujet : on attend que l'abonnement d'un rendu
    // précédent (écran remonté, double effet du mode strict) soit retiré avant d'en ouvrir un neuf.
    let channels: RealtimeChannel[] = [];
    void Promise.all(names.map((name) => closing.get(name))).then(() => {
      if (!live) return;
      channels = names.map((name) =>
        supabase
          .channel(name, { config: { private: true } })
          .on('broadcast', { event: MESSAGE_POSTED }, (message: { payload?: unknown }) => {
            if (!live) return;
            const channelId = (message.payload as { channel_id?: unknown } | undefined)?.channel_id;
            signal.current(typeof channelId === 'string' ? channelId : undefined);
          })
          .subscribe((status) => onStatus(name, status)),
      );
    });
    // Un abonnement qui n'a pas abouti à la première échéance (Realtime injoignable, sans réponse) passe aussi
    // en relecture.
    const poll = () => {
      if (!subscribed() && !polling) {
        polling = true;
        show();
      }
      if (polling && document.visibilityState === 'visible') signal.current();
    };
    const timer = setInterval(poll, CLIENT_SETTINGS.chatPollSeconds * 1_000);
    const safety = setInterval(() => {
      if (subscribed() && document.visibilityState === 'visible') signal.current();
    }, CLIENT_SETTINGS.chatSafetyRereadSeconds * 1_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') signal.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      clearInterval(timer);
      clearInterval(safety);
      document.removeEventListener('visibilitychange', onVisible);
      for (const [index, channel] of channels.entries()) {
        const name = names[index] ?? '';
        const removed = supabase.removeChannel(channel).then(
          () => undefined,
          () => undefined,
        );
        closing.set(name, removed);
        void removed.then(() => {
          if (closing.get(name) === removed) closing.delete(name);
        });
      }
    };
  }, [key]);

  return key === null ? 'connecting' : state;
}
