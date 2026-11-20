import {
  BLAZON_EMBLEMS,
  BLAZON_SHAPES,
  BLAZON_TINCTURES,
  HOUSE_NAME_PATTERN,
  normalizeHouseName,
  type Blazon,
} from '@oikos/contracts';
import {
  Badge,
  Button,
  Check,
  CityVignette,
  FilterX,
  GodEmblem,
  Select,
  Stepper,
  TextField,
} from '@oikos/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createHouse } from '../api';
import { Blazon as BlazonPreview } from '../Blazon';
import { describeCity, parseCityIdentities, type CityIdentity } from '../city-identity';
import { useRows, useSiteRules } from '../data';
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
  // Filtres de la liste des cités (#707) : dieu protecteur, matière première du terroir ; vides, toutes.
  const [godFilter, setGodFilter] = useState('');
  const [rawFilter, setRawFilter] = useState('');
  const siteRules = useSiteRules().rules;
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
    const full = fullCityIds.includes(city.id);
    return (
      // Toute la carte se clique ; le nom vient du seul nom de la cité. La description, lue une fois par
      // `aria-describedby`, reprend en texte les lignes que l'œil lit en dieu, terroir et port.
      <label
        key={city.id}
        className="group relative flex cursor-pointer overflow-hidden rounded-xl border-2 border-border bg-surface-raised shadow-sm transition-[border-color,background-color] duration-(--motion-fast) hover:border-foreground-secondary has-[:checked]:border-primary has-[:checked]:bg-primary-subtle has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-(--focus) md:flex-col"
      >
        <input
          type="radio"
          name="city"
          required
          // Invisible mais sur toute la carte : le clic, le toucher et le foyer (anneau sur la carte) l'atteignent.
          className="absolute inset-0 size-full cursor-pointer opacity-0"
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
        <span
          aria-hidden="true"
          className="absolute top-2 right-2 z-10 hidden size-6 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm group-has-[:checked]:grid"
        >
          <Check className="size-4" strokeWidth={3} />
        </span>
        <CityVignette
          cityId={city.slug}
          className="m-3 mr-0 h-auto w-28 shrink-0 self-start rounded-lg md:m-0 md:w-full md:rounded-none md:border-b md:border-border-subtle"
        />
        <span className="flex min-w-0 flex-1 flex-col gap-2 p-3">
          <span className="flex items-center justify-between gap-2">
            <span id={`city-name-${city.id}`} className="pr-7 text-lg font-semibold">
              {cityName(city)}
            </span>
          </span>
          {lines && (
            <span
              aria-hidden="true"
              className="flex flex-col gap-1.5 text-sm text-muted-foreground"
            >
              <span className="flex items-center gap-2 text-foreground">
                {identity?.patronGodId && <GodEmblem godId={identity.patronGodId} size={28} />}
                {lines.god}
              </span>
              <span>{lines.terroir}</span>
              <span>{[lines.port, lines.start].join(' · ')}</span>
            </span>
          )}
          {full && (
            <Badge tone="danger" aria-hidden="true" className="self-start">
              {t('createHouse.cityFull')}
            </Badge>
          )}
          <span id={`city-${city.id}`} className="sr-only">
            {[
              ...(lines ? [lines.god, lines.port, lines.terroir, lines.start] : []),
              ...(identities && !identity ? [t('cityIdentity.missing')] : []),
              ...(full ? [t('createHouse.cityFull')] : []),
            ].join(' · ')}
          </span>
        </span>
      </label>
    );
  };

  // Une matière première se nomme par le bien de sa recette de terroir, à défaut par la recette.
  const rawName = (recipeId: string) => {
    const good = siteRules?.recipe(recipeId)?.outputs[0]?.goodId;
    return good
      ? t(`goods.${good}`, { defaultValue: good })
      : t(`recipes.${recipeId}`, { defaultValue: recipeId });
  };
  const known = [...(identities?.values() ?? [])];
  const options = (ids: string[], name: (id: string) => string) =>
    [...new Set(ids)]
      .map((id) => ({ id, name: name(id) }))
      .sort((a, b) => a.name.localeCompare(b.name, i18n.language));
  const gods = options(
    known.flatMap(({ patronGodId }) => (patronGodId ? [patronGodId] : [])),
    (id) => t(`gods.${id}`, { defaultValue: id }),
  );
  const raws = options(
    known.flatMap(({ terroir }) => terroir ?? []),
    rawName,
  );
  const shown = cities.filter((city) => {
    const identity = identities?.get(city.id);
    if (!identity) return !godFilter && !rawFilter;
    return (
      (!godFilter || identity.patronGodId === godFilter) &&
      (!rawFilter || identity.terroir === null || identity.terroir.includes(rawFilter))
    );
  });
  const filter = (
    id: string,
    label: string,
    value: string,
    set: (value: string) => void,
    all: string,
    list: { id: string; name: string }[],
  ) => (
    <Select id={id} label={label} quiet value={value} onChange={(event) => set(event.target.value)}>
      <option value="">{all}</option>
      {list.map((option) => (
        <option key={option.id} value={option.id}>
          {option.name}
        </option>
      ))}
    </Select>
  );

  const chosenIdentity = chosen && identities?.get(chosen.id);
  const chosenLines = describe(chosenIdentity);

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
                {identities && identities.size > 0 && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {filter(
                      'city-god',
                      t('createHouse.filterGod'),
                      godFilter,
                      setGodFilter,
                      t('createHouse.allGods'),
                      gods,
                    )}
                    {filter(
                      'city-raw',
                      t('createHouse.filterRaw'),
                      rawFilter,
                      setRawFilter,
                      t('createHouse.allRaws'),
                      raws,
                    )}
                  </div>
                )}
                <p role="status" className="text-sm text-muted-foreground">
                  {shown.length === cities.length
                    ? t('createHouse.cityCount', { count: cities.length })
                    : t('createHouse.cityShown', { count: shown.length, total: cities.length })}
                </p>
                {shown.length === 0 && (
                  <Button
                    icon={<FilterX aria-hidden="true" />}
                    variant="secondary"
                    className="self-start"
                    onClick={() => {
                      setGodFilter('');
                      setRawFilter('');
                    }}
                  >
                    {t('createHouse.clearFilters')}
                  </Button>
                )}
                <div className="grid gap-3 md:grid-cols-2">{shown.map(cityCard)}</div>
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
                      {t('createHouse.summaryBlazon')}
                    </dt>
                    <dd>
                      {(['shape', 'tincture', 'emblem'] as const)
                        .map((part) => t(`blazon.${part}.${blazon[part]}` as string))
                        .join(' · ')}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted-foreground">
                      {t('createHouse.summaryCity')}
                    </dt>
                    <dd className="flex items-center gap-3">
                      {chosen && (
                        <CityVignette cityId={chosen.slug} className="h-auto w-24 rounded-lg" />
                      )}
                      <span className="flex flex-col gap-1">
                        <span className="font-semibold">{chosen && cityName(chosen)}</span>
                        {chosenLines && (
                          <span className="flex items-center gap-2 text-sm text-muted-foreground">
                            {chosenIdentity?.patronGodId && (
                              <GodEmblem godId={chosenIdentity.patronGodId} size={24} />
                            )}
                            {chosenLines.god}
                          </span>
                        )}
                      </span>
                    </dd>
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
