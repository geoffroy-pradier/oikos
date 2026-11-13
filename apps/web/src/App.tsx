import type { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card } from '@oikos/ui';
import { RouterProvider } from '@tanstack/react-router';
import { HouseProvider } from './house';
import { router } from './router';
import { CreateHouse, type City } from './screens/CreateHouse';
import { SignIn } from './screens/SignIn';
import { supabase } from './supabase';

interface House {
  name: string;
  city_id: string;
  citizenship_status: 'metic' | 'citizen';
}

export function App() {
  const { t, i18n } = useTranslation();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [house, setHouse] = useState<House | null | undefined>(undefined);
  const [cities, setCities] = useState<City[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  const load = useCallback(async () => {
    // Un échec de lecture (erreur de l'API ou réseau coupé) n'est jamais pris pour « pas de maison ».
    const [mine, allCities] = await Promise.all([
      supabase
        .from('houses')
        .select('name, city_id, citizenship_status')
        .eq('is_mine', true)
        .maybeSingle(),
      supabase.from('cities').select('id, name').order('name'),
    ]).catch(() => [null, null] as const);
    const failed = !mine || !allCities || Boolean(mine.error ?? allCities.error);
    setLoadFailed(failed);
    if (failed) return;
    setCities((allCities.data as City[] | null) ?? []);
    setHouse((mine.data as House | null) ?? null);
  }, []);
  useEffect(() => {
    if (userId) void load();
    else setHouse(undefined);
  }, [userId, load]);

  // Maison fondée : la coquille de navigation et ses cinq onglets.
  if (session && house && !loadFailed) {
    const cityName = cities.find((candidate) => candidate.id === house.city_id)?.name ?? '';
    return (
      <HouseProvider
        value={{ name: house.name, cityName, citizenshipStatus: house.citizenship_status }}
      >
        <RouterProvider router={router} />
      </HouseProvider>
    );
  }

  let screen = <p>{t('app.loading')}</p>;
  if (session === null) screen = <SignIn />;
  else if (session && loadFailed) {
    screen = (
      <>
        <p role="alert">{t('app.loadFailed')}</p>
        <Button onClick={() => void load()}>{t('app.retry')}</Button>
      </>
    );
  } else if (session && house === null) {
    screen = <CreateHouse cities={cities} accessToken={session.access_token} onCreated={load} />;
  }

  // Avant la maison : un seul écran centré, sans navigation.
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="p-4 text-center font-display text-3xl font-semibold text-primary">
        {t('app.title')}
      </header>
      <div className="meander" aria-hidden="true" />
      <main className="mx-auto max-w-md p-4">
        <Card className="flex flex-col gap-3">{screen}</Card>
      </main>
    </div>
  );
}
