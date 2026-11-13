import type { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGES } from './i18n';
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
    const [mine, allCities] = await Promise.all([
      supabase
        .from('houses')
        .select('name, city_id, citizenship_status')
        .eq('is_mine', true)
        .maybeSingle(),
      supabase.from('cities').select('id, name').order('name'),
    ]);
    setCities((allCities.data as City[] | null) ?? []);
    setHouse((mine.data as House | null) ?? null);
  }, []);
  useEffect(() => {
    if (userId) void load();
    else setHouse(undefined);
  }, [userId, load]);

  let screen = <p>{t('app.loading')}</p>;
  if (session === null) screen = <SignIn />;
  else if (session && house === null) {
    screen = <CreateHouse cities={cities} accessToken={session.access_token} onCreated={load} />;
  } else if (session && house) {
    const city = cities.find((candidate) => candidate.id === house.city_id)?.name ?? '';
    screen = (
      <section>
        <h1>{t('home.title', { name: house.name })}</h1>
        <p>{t(`home.status.${house.citizenship_status}`, { city })}</p>
      </section>
    );
  }

  return (
    <>
      <header>
        <strong>{t('app.title')}</strong>
        <label htmlFor="language">{t('app.language')}</label>
        <select
          id="language"
          value={i18n.language}
          onChange={(event) => void i18n.changeLanguage(event.target.value)}
        >
          {LANGUAGES.map((language) => (
            <option key={language} value={language}>
              {language.toUpperCase()}
            </option>
          ))}
        </select>
        {session && (
          <button type="button" onClick={() => void supabase.auth.signOut()}>
            {t('app.signOut')}
          </button>
        )}
      </header>
      <main>{screen}</main>
    </>
  );
}
