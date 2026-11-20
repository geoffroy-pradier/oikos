import type { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { blazonSchema } from '@oikos/contracts';
import {
  Button,
  Card,
  cn,
  EmptyState,
  House,
  LogOut,
  RefreshCw,
  Skeleton,
  TriangleAlert,
} from '@oikos/ui';
import { RouterProvider } from '@tanstack/react-router';
import { HouseProvider } from './house';
import { LanguageSelect } from './LanguageSelect';
import { router } from './router';
import { serverClock } from './server-clock';
import { CreateHouse, type City } from './screens/CreateHouse';
import { SignIn } from './screens/SignIn';
import { refusedToken, renewOrEnd, SESSION_ENDED_EVENT } from './session';
import { supabase } from './supabase';

interface House {
  id: string;
  name: string;
  city_id: string;
  citizenship_status: 'metic' | 'citizen';
  blazon: unknown;
}

/** Âge (monde de jeu) servi par ce client : identifiant court, fixé à la construction (`.env.example`). */
const WORLD_SLUG = (import.meta.env['VITE_WORLD_SLUG'] as string | undefined) ?? 'archipel';

export function App() {
  const { t, i18n } = useTranslation();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [house, setHouse] = useState<House | null | undefined>(undefined);
  const [cities, setCities] = useState<City[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  /** Session fermée sur un refus de l'API (#565) : la connexion dit pourquoi, jusqu'à la suivante. */
  const [sessionEnded, setSessionEnded] = useState(false);

  useEffect(() => {
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event === 'SIGNED_IN') setSessionEnded(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // L'API refuse le jeton : la session est d'abord renouvelée (jeton expiré au réveil de l'appareil) ; refusée
  // par Supabase Auth (compte effacé), elle est fermée sur cet appareil et l'adresse revient à l'accueil, comme à
  // la déconnexion (`Shell`). Renouvelée, le joueur renvoie sa commande, sous la même clé ; un jeton renouvelé que
  // l'API refuse encore ferme la session sans nouveau renouvellement (`renewOrEnd`).
  useEffect(() => {
    const end = async (event: Event) => {
      // Heure de l'API, si connue : l'expiration du jeton refusé se juge malgré une horloge fausse.
      const now = serverClock.now().getTime();
      if ((await renewOrEnd(supabase.auth, refusedToken(event), now)) !== 'ended') return;
      setSessionEnded(true);
      void router.navigate({ to: '/' });
    };
    const listener = (event: Event) => void end(event);
    window.addEventListener(SESSION_ENDED_EVENT, listener);
    return () => window.removeEventListener(SESSION_ENDED_EVENT, listener);
  }, []);

  const userId = session?.user.id;
  const load = useCallback(async () => {
    // Un échec de lecture (erreur de l'API ou réseau coupé) n'est jamais pris pour « pas de maison ».
    const [mine, world] = await Promise.all([
      supabase
        .from('houses')
        .select('id, name, city_id, citizenship_status, blazon')
        .eq('is_mine', true)
        .maybeSingle(),
      supabase.from('worlds').select('id').eq('slug', WORLD_SLUG).maybeSingle(),
    ]).catch(() => [null, null] as const);
    // Seules les cités de l'Âge servi par ce client sont proposées : jamais celles d'un autre monde.
    const worldId = (world?.data as { id: string } | null)?.id;
    const worldCities = worldId
      ? await supabase
          .from('cities')
          .select('id, worldId:world_id, slug, name')
          .eq('world_id', worldId)
          .order('name')
          .then(
            (response) => response,
            () => null,
          )
      : null;
    const failed =
      !mine || !world || !worldCities || Boolean(mine.error ?? world.error ?? worldCities.error);
    setLoadFailed(failed);
    if (failed) return;
    setCities((worldCities.data as City[] | null) ?? []);
    setHouse((mine.data as House | null) ?? null);
  }, []);
  useEffect(() => {
    if (userId) void load();
    else setHouse(undefined);
  }, [userId, load]);

  // Maison fondée : la coquille de navigation et ses cinq onglets.
  if (session && house && !loadFailed) {
    // Nom traduit par identifiant court ; le nom enregistré, faute de traduction.
    const nameOf = (city: City) => t(`cities.${city.slug}`, { defaultValue: city.name });
    const home = cities.find((candidate) => candidate.id === house.city_id);
    const cityName = home ? nameOf(home) : '';
    return (
      <HouseProvider
        value={{
          id: house.id,
          name: house.name,
          cityId: house.city_id,
          cityName,
          cityNames: Object.fromEntries(cities.map((city) => [city.id, nameOf(city)])),
          citySlugs: Object.fromEntries(cities.map((city) => [city.id, city.slug])),
          citizenshipStatus: house.citizenship_status,
          accessToken: session.access_token,
          blazon: blazonSchema.safeParse(house.blazon).data ?? null,
        }}
      >
        <RouterProvider router={router} />
      </HouseProvider>
    );
  }

  let screen = (
    <div role="status" aria-label={t('app.loading')} className="flex flex-col gap-3">
      <Skeleton className="h-7 w-2/3" />
      <Skeleton className="h-11 w-full" />
    </div>
  );
  if (session === null) screen = <SignIn sessionEnded={sessionEnded} />;
  else if (session && loadFailed) {
    screen = (
      <EmptyState
        icon={<TriangleAlert />}
        title={<span role="alert">{t('app.loadFailed')}</span>}
        action={
          <Button icon={<RefreshCw aria-hidden="true" />} onClick={() => void load()}>
            {t('app.retry')}
          </Button>
        }
      />
    );
  } else if (session && house === null) {
    screen = <CreateHouse cities={cities} accessToken={session.access_token} onCreated={load} />;
  }

  // Avant la maison : un seul écran centré, sans navigation ; la connexion, centrée aussi en hauteur sur
  // ordinateur (#869).
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-2 p-4">
        <p className="flex items-center gap-2.5 text-lg font-bold tracking-tight">
          <span
            aria-hidden="true"
            className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"
          >
            <House className="size-5" strokeWidth={2} />
          </span>
          {t('app.title')}
        </p>
        <div className="flex items-center gap-2">
          <LanguageSelect />
          {session && (
            <Button
              icon={<LogOut aria-hidden="true" />}
              variant="ghost"
              onClick={() => void supabase.auth.signOut()}
            >
              {t('app.signOut')}
            </Button>
          )}
        </div>
      </header>
      <main
        className={cn(
          'mx-auto w-full animate-rise p-4',
          session === null
            ? 'max-w-4xl md:flex md:flex-1 md:flex-col md:justify-center md:pb-18'
            : 'max-w-2xl',
        )}
      >
        {session === null ? (
          screen
        ) : (
          <Card elevation="raised" className="flex flex-col gap-3">
            {screen}
          </Card>
        )}
      </main>
    </div>
  );
}
