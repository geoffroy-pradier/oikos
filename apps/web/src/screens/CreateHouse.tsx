import {
  BLAZON_EMBLEMS,
  BLAZON_SHAPES,
  BLAZON_TINCTURES,
  HOUSE_NAME_PATTERN,
  normalizeHouseName,
  type Blazon,
} from '@oikos/contracts';
import { Badge, Select, Stepper, TextField } from '@oikos/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createHouse } from '../api';
import { Blazon as BlazonPreview } from '../Blazon';
import { describeCity, parseCityIdentities, type CityIdentity } from '../city-identity';
import { useRows } from '../data';
import { LoadProblem } from './LoadProblem';

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

/** Refus qui se corrigent au nom, ou au choix de la cité : l'écran y ramène le joueur. */
const NAME_ERRORS = ['VALIDATION_FAILED', 'HOUSE_NAME_TAKEN', 'MESSAGE_REJECTED', 'SILENCED'];
const CITY_ERRORS = ['CITY_REQUIRED', 'NO_WORKERS_AVAILABLE'];

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
  // Aucune cité n'est choisie d'avance : le joueur choisit lui-même, d'après dieu et terroir.
  const [cityId, setCityId] = useState('');
  const [blazon, setBlazon] = useState<Blazon>({
    shape: BLAZON_SHAPES[0],
    tincture: BLAZON_TINCTURES[0],
    emblem: BLAZON_EMBLEMS[0],
  });
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Cités qui ont refusé un premier site faute de travailleurs (4.4, #258) : l'écran propose les autres.
  const [fullCityIds, setFullCityIds] = useState<string[]>([]);
  // Refus qui se corrige à une étape : le Stepper est remonté sur elle (la saisie vit ici, rien ne se perd).
  const [back, setBack] = useState({ step: 'name', round: 0 });
  const cityName = (city: City) => t(`cities.${city.slug}`, { defaultValue: city.name });
  const chosen = cities.find((city) => city.id === cityId);
  const describe = (identity: CityIdentity | undefined) =>
    identity ? describeCity(identity, t, i18n.language) : null;

  // Le foyer suit le joueur à l'étape où se corrige le refus ; la région vivante annonce le message.
  useEffect(() => {
    if (back.round === 0) return;
    const field = back.step === 'name' ? '#name' : 'input[name="city"]';
    document.querySelector<HTMLElement>(field)?.focus();
  }, [back]);

  const nameError = errorCode !== null && NAME_ERRORS.includes(errorCode);
  const cityError = errorCode !== null && CITY_ERRORS.includes(errorCode);
  const checkName = () => {
    const valid = HOUSE_NAME_PATTERN.test(normalizeHouseName(name));
    if (!valid) setErrorCode('VALIDATION_FAILED');
    else if (nameError) setErrorCode(null);
    return valid;
  };
  const checkCity = () => {
    if (!cityId) setErrorCode('CITY_REQUIRED');
    return Boolean(cityId);
  };

  async function confirm() {
    setErrorCode(null);
    setBusy(true);
    const input = { cityId, name: normalizeHouseName(name), blazon };
    const result = await createHouse(input, accessToken);
    if (result.ok || result.error.code === 'HOUSE_ALREADY_EXISTS') await onCreated();
    if (!result.ok) {
      const code = result.error.code;
      setErrorCode(code);
      if (code === 'NO_WORKERS_AVAILABLE') {
        setFullCityIds((full) => [...new Set([...full, cityId])]);
        setCityId('');
      }
      const step = NAME_ERRORS.includes(code) ? 'name' : CITY_ERRORS.includes(code) ? 'city' : null;
      if (step) setBack((previous) => ({ step, round: previous.round + 1 }));
    }
    setBusy(false);
  }

  const others = cities.filter((city) => !fullCityIds.includes(city.id)).map(cityName);
  const errorText =
    errorCode === 'NO_WORKERS_AVAILABLE'
      ? others.length > 0
        ? t('createHouse.noWorkers', { cities: others.join(', ') })
        : t('createHouse.noWorkersAnywhere')
      : errorCode === 'MESSAGE_REJECTED'
        ? t('createHouse.nameRejected')
        : errorCode === 'SILENCED'
          ? t('createHouse.silenced')
          : errorCode && t([`errors.${errorCode}`, 'errors.INTERNAL']);

  const select = <K extends keyof Blazon>(part: K, options: readonly Blazon[K][]) => (
    <Select
      label={t(`createHouse.${part}` as string)}
      value={blazon[part]}
      onChange={(event) => setBlazon({ ...blazon, [part]: event.target.value })}
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {t(`blazon.${part}.${option}` as string)}
        </option>
      ))}
    </Select>
  );

  const cityCard = (city: City) => {
    const identity = identities?.get(city.id);
    const lines = describe(identity);
    return (
      // Toute la carte se clique ; le nom vient du seul nom de la cité, la description n'est lue
      // qu'une fois, par `aria-describedby`.
      <label
        key={city.id}
        className="flex cursor-pointer gap-3 rounded-xl border border-border bg-surface-raised p-3 shadow-sm transition-colors duration-(--motion-fast) hover:border-foreground-secondary has-[:checked]:border-primary has-[:checked]:ring-2 has-[:checked]:ring-primary has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-(--focus)"
      >
        <input
          type="radio"
          name="city"
          required
          className="mt-1 size-5 shrink-0"
          value={city.id}
          checked={cityId === city.id}
          onChange={() => {
            setCityId(city.id);
            if (cityError) setErrorCode(null);
          }}
          aria-labelledby={`city-name-${city.id}`}
          aria-describedby={`city-${city.id}${cityError ? ' form-error' : ''}`}
          aria-invalid={cityError}
        />
        <span className="flex min-w-0 flex-col">
          <span id={`city-name-${city.id}`} className="font-semibold">
            {cityName(city)}
          </span>
          <span id={`city-${city.id}`} className="text-sm text-muted-foreground">
            {lines && [lines.god, lines.port, lines.terroir, lines.start].join(' · ')}
            {identities && !identity && t('cityIdentity.missing')}
            {fullCityIds.includes(city.id) && (
              <Badge tone="danger" className="ml-2">
                {t('createHouse.cityFull')}
              </Badge>
            )}
          </span>
        </span>
      </label>
    );
  };

  return (
    <>
      <h1 className="text-2xl">{t('createHouse.title')}</h1>
      <p className="text-muted-foreground">{t('createHouse.intro')}</p>
      <Stepper
        key={back.round}
        initialStep={back.round > 0 ? back.step : undefined}
        confirming={busy}
        onConfirm={() => void confirm()}
        labels={{
          progress: t('stepper.progress'),
          back: t('stepper.back'),
          next: t('stepper.next'),
          confirm: t('createHouse.submit'),
          stepOf: (current, total) => t('stepper.stepOf', { current, total }),
        }}
        steps={[
          {
            id: 'name',
            title: t('createHouse.steps.name'),
            check: checkName,
            content: (
              <TextField
                id="name"
                label={t('createHouse.name')}
                hint={t('createHouse.nameHint')}
                error={nameError ? errorText : undefined}
                required
                maxLength={24}
                autoComplete="off"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            ),
          },
          {
            id: 'blazon',
            title: t('createHouse.steps.blazon'),
            content: (
              <fieldset className="flex flex-col gap-3">
                <legend className="sr-only">{t('createHouse.blazon')}</legend>
                <BlazonPreview blazon={blazon} className="size-24 self-center" />
                <div className="grid gap-3 sm:grid-cols-3">
                  {select('shape', BLAZON_SHAPES)}
                  {select('tincture', BLAZON_TINCTURES)}
                  {select('emblem', BLAZON_EMBLEMS)}
                </div>
              </fieldset>
            ),
          },
          {
            id: 'city',
            title: t('createHouse.steps.city'),
            check: checkCity,
            content: (
              <fieldset className="flex flex-col gap-3" aria-describedby="city-hint">
                <legend className="sr-only">{t('createHouse.city')}</legend>
                <p id="city-hint" className="text-sm text-muted-foreground">
                  {t('createHouse.cityHint')}
                </p>
                {(read.failed || (read.rows !== null && identities === null)) && (
                  <LoadProblem onRetry={() => read.reload()} />
                )}
                <div className="grid gap-3 sm:grid-cols-2">{cities.map(cityCard)}</div>
                <p id="form-error" role="alert" className="font-semibold text-danger">
                  {cityError ? errorText : ''}
                </p>
              </fieldset>
            ),
          },
          {
            id: 'summary',
            title: t('createHouse.steps.summary'),
            valid: Boolean(cityId),
            content: (
              <div className="flex flex-col gap-3">
                <p className="text-muted-foreground">{t('createHouse.summaryIntro')}</p>
                <dl className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-muted/60 p-3">
                  <div className="flex items-center gap-3">
                    <BlazonPreview blazon={blazon} className="size-14 shrink-0" />
                    <div>
                      <dt className="text-sm text-muted-foreground">
                        {t('createHouse.summaryName')}
                      </dt>
                      <dd className="text-lg font-semibold">{normalizeHouseName(name)}</dd>
                    </div>
                  </div>
                  <div>
                    <dt className="text-sm text-muted-foreground">
                      {t('createHouse.summaryCity')}
                    </dt>
                    <dd className="font-semibold">{chosen && cityName(chosen)}</dd>
                  </div>
                </dl>
                <p id="summary-error" role="alert" className="font-semibold text-danger">
                  {errorCode && !nameError && !cityError ? errorText : ''}
                </p>
              </div>
            ),
          },
        ]}
      />
    </>
  );
}
