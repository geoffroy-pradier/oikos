import {
  BLAZON_EMBLEMS,
  BLAZON_SHAPES,
  BLAZON_TINCTURES,
  HOUSE_NAME_PATTERN,
  normalizeHouseName,
  type Blazon,
} from '@oikos/contracts';
import { Button } from '@oikos/ui';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { createHouse } from '../api';
import { describeCity, parseCityIdentities } from '../city-identity';
import { useRows } from '../data';
import { LoadProblem } from './LoadProblem';

const CONTROL = 'min-h-11 w-full rounded-md border border-border bg-surface px-3';

export interface City {
  id: string;
  worldId: string;
  /** Identifiant court : celui de la configuration et des traductions. */
  slug: string;
  /** Nom enregistré, affiché faute de traduction. */
  name: string;
}

interface Props {
  cities: City[];
  accessToken: string;
  /** Relit la maison du joueur : appelé après une création, ou si l'API dit qu'elle existe déjà. */
  onCreated: () => Promise<void>;
}

export function CreateHouse({ cities, accessToken, onCreated }: Props) {
  const { t, i18n } = useTranslation();
  // Identité des cités du monde (6.1) : dieu protecteur, port, terroir, premier site.
  const read = useRows<unknown>(
    'city_identity',
    'city_id, terroir, has_port, patron_god_id, starting_recipe_id',
    'slug',
    { world_id: cities[0]?.worldId ?? '' },
  );
  const identities = read.rows === null ? null : parseCityIdentities(read.rows);
  const [name, setName] = useState('');
  const [cityId, setCityId] = useState(cities[0]?.id ?? '');
  const [blazon, setBlazon] = useState<Blazon>({
    shape: BLAZON_SHAPES[0],
    tincture: BLAZON_TINCTURES[0],
    emblem: BLAZON_EMBLEMS[0],
  });
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = normalizeHouseName(name);
    if (!HOUSE_NAME_PATTERN.test(trimmed)) return setErrorCode('VALIDATION_FAILED');
    setErrorCode(null);
    setBusy(true);
    const result = await createHouse({ cityId, name: trimmed, blazon }, accessToken);
    if (result.ok || result.error.code === 'HOUSE_ALREADY_EXISTS') await onCreated();
    if (!result.ok) setErrorCode(result.error.code);
    setBusy(false);
  }

  const select = <K extends keyof Blazon>(part: K, options: readonly Blazon[K][]) => (
    <>
      <label htmlFor={part}>{t(`createHouse.${part}` as string)}</label>
      <select
        className={CONTROL}
        id={part}
        value={blazon[part]}
        onChange={(event) => setBlazon({ ...blazon, [part]: event.target.value })}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {t(`blazon.${part}.${option}` as string)}
          </option>
        ))}
      </select>
    </>
  );

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-2">
      <h1 className="text-2xl">{t('createHouse.title')}</h1>
      <p>{t('createHouse.intro')}</p>
      <label htmlFor="name">{t('createHouse.name')}</label>
      <input
        className={CONTROL}
        id="name"
        required
        maxLength={24}
        aria-describedby="name-hint form-error"
        aria-invalid={errorCode === 'VALIDATION_FAILED' || errorCode === 'HOUSE_NAME_TAKEN'}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <p id="name-hint" className="text-sm text-muted-foreground">
        {t('createHouse.nameHint')}
      </p>
      <fieldset className="flex flex-col gap-2" aria-describedby="city-hint">
        <legend>{t('createHouse.city')}</legend>
        <p id="city-hint" className="text-sm text-muted-foreground">
          {t('createHouse.cityHint')}
        </p>
        {(read.failed || (read.rows !== null && identities === null)) && (
          <LoadProblem onRetry={() => read.reload()} />
        )}
        {cities.map((city) => {
          const identity = identities?.get(city.id);
          const lines = identity ? describeCity(identity, t, i18n.language) : null;
          return (
            <label
              key={city.id}
              className="flex gap-3 rounded-md border border-border p-3 has-[:checked]:border-primary"
            >
              <input
                type="radio"
                name="city"
                className="mt-1 size-5 shrink-0"
                value={city.id}
                checked={cityId === city.id}
                onChange={() => setCityId(city.id)}
                aria-describedby={lines ? `city-${city.id}` : undefined}
              />
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold">
                  {t(`cities.${city.slug}`, { defaultValue: city.name })}
                </span>
                {lines && (
                  <span id={`city-${city.id}`} className="text-sm text-muted-foreground">
                    {[lines.god, lines.port, lines.terroir, lines.start].join(' · ')}
                  </span>
                )}
                {identities && !identity && (
                  <span className="text-sm text-muted-foreground">{t('cityIdentity.missing')}</span>
                )}
              </span>
            </label>
          );
        })}
      </fieldset>
      <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3">
        <legend>{t('createHouse.blazon')}</legend>
        {select('shape', BLAZON_SHAPES)}
        {select('tincture', BLAZON_TINCTURES)}
        {select('emblem', BLAZON_EMBLEMS)}
      </fieldset>
      <p id="form-error" role="alert" className="font-semibold text-danger">
        {errorCode && t([`errors.${errorCode}`, 'errors.INTERNAL'])}
      </p>
      <Button type="submit" disabled={busy || !cityId}>
        {t('createHouse.submit')}
      </Button>
    </form>
  );
}
