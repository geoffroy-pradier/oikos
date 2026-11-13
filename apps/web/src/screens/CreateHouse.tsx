import {
  BLAZON_EMBLEMS,
  BLAZON_SHAPES,
  BLAZON_TINCTURES,
  HOUSE_NAME_PATTERN,
  normalizeHouseName,
  type Blazon,
} from '@oikos/contracts';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { createHouse } from '../api';

export interface City {
  id: string;
  name: string;
}

interface Props {
  cities: City[];
  accessToken: string;
  /** Relit la maison du joueur : appelé après une création, ou si l'API dit qu'elle existe déjà. */
  onCreated: () => Promise<void>;
}

export function CreateHouse({ cities, accessToken, onCreated }: Props) {
  const { t } = useTranslation();
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
    <form onSubmit={submit} noValidate>
      <h1>{t('createHouse.title')}</h1>
      <p>{t('createHouse.intro')}</p>
      <label htmlFor="name">{t('createHouse.name')}</label>
      <input
        id="name"
        required
        maxLength={24}
        aria-describedby="name-hint form-error"
        aria-invalid={errorCode === 'VALIDATION_FAILED' || errorCode === 'HOUSE_NAME_TAKEN'}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <p id="name-hint">{t('createHouse.nameHint')}</p>
      <label htmlFor="city">{t('createHouse.city')}</label>
      <select id="city" value={cityId} onChange={(event) => setCityId(event.target.value)}>
        {cities.map((city) => (
          <option key={city.id} value={city.id}>
            {city.name}
          </option>
        ))}
      </select>
      <fieldset>
        <legend>{t('createHouse.blazon')}</legend>
        {select('shape', BLAZON_SHAPES)}
        {select('tincture', BLAZON_TINCTURES)}
        {select('emblem', BLAZON_EMBLEMS)}
      </fieldset>
      <p id="form-error" role="alert">
        {errorCode && t([`errors.${errorCode}`, 'errors.INTERNAL'])}
      </p>
      <button type="submit" disabled={busy || !cityId}>
        {t('createHouse.submit')}
      </button>
    </form>
  );
}
