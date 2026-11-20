import {
  Button,
  Coins,
  Field,
  Hammer,
  PartyPopper,
  Ship,
  ScrollText as Scroll,
  Sheet,
  StatusRegion,
  Stepper,
} from '@oikos/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cityCommand } from '../api';
import { useRows } from '../data';
import {
  checkDecreeParams,
  parseDecreeRules,
  readTypedNumber,
  typedIntegerProblem,
  type FormDecreeModel,
} from '../decrees';
import { useHouse } from '../house';
import { useMoney } from '../money';
import { parseOffices } from '../politics';
import { LoadProblem } from './LoadProblem';

type Notice = { kind: 'status' | 'alert'; text: string } | null;
/** Choix en carte (modèle, bien d'une fête) : la case cochée la met en avant. */
const CHOICE =
  'flex cursor-pointer gap-3 rounded-xl border border-border-subtle p-3 transition-colors duration-(--motion-fast) hover:bg-muted has-[:checked]:border-primary has-[:checked]:bg-primary-subtle';
const BPS = 10_000;
/** Paramètre du décret que porte chaque champ saisi. */
const PARAMS = { rate: 'rateBps', factor: 'coefficientBps', amount: 'amountOboles', days: 'days' };
/** Champs qui portent un nombre entier : montant en oboles, durée en jours. */
const INTEGERS = new Set<keyof typeof PARAMS>(['amount', 'days']);

/**
 * Proposition d'un décret par l'archonte en charge (6.3), d'après le catalogue fermé en vigueur
 * (`decree_rules`) : un modèle ouvert, ses paramètres, chacun avec ses bornes annoncées. Rien ne part tant que
 * la saisie sort des bornes ; l'API revérifie tout, plafond de dépense compris. Rien pour une autre maison.
 */
export function DecreeForm(props: { onDone: () => Promise<unknown> }) {
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const money = useMoney();
  const percent = new Intl.NumberFormat(i18n.language, {
    style: 'percent',
    maximumFractionDigits: 2,
  });
  const factor = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 });
  const number = new Intl.NumberFormat(i18n.language);
  /** Nombre saisi, au format de la langue (`readTypedNumber`) ; rien de saisi ou illisible : `NaN`. */
  const read = (typed: string) => readTypedNumber(typed, i18n.language) ?? NaN;
  const ruleRows = useRows<unknown>(
    'decree_rules',
    'model, bounds, voting_days, quorum_bps, max_open_per_city, spending_cap_share_bps',
    'model',
  );
  const officeRows = useRows<unknown>(
    'offices',
    'house_id, office, ends_at, in_office',
    'starts_at',
    {
      city_id: house.cityId,
    },
  );
  const rules = ruleRows.rows === null ? null : parseDecreeRules(ruleRows.rows);
  const offices = officeRows.rows === null ? null : parseOffices(officeRows.rows);
  const archon = offices?.some(
    (office) => office.office === 'archon' && office.inOffice && office.houseId === house.id,
  );
  const [model, setModel] = useState<FormDecreeModel | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  // `null` : aucune case encore touchée.
  const [goods, setGoods] = useState<string[] | null>(null);
  const goodsError = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const keys = useRef(new Map<string, string>());
  const noticeElement = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  // Feuille de proposition ouverte ; un refus de l'API s'y dit, à l'étape du récapitulatif.
  const [open, setOpen] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  // Proposé, la feuille se ferme : son bouton disparu, le foyer passe sur le résultat.
  useEffect(() => {
    if (notice) noticeElement.current?.focus();
  }, [notice]);
  // Une lecture en échec est dite : l'archonte ne perd pas son formulaire sans savoir pourquoi.
  const officesFailed = officeRows.failed || (officeRows.rows !== null && !offices);
  const rulesFailed = ruleRows.failed || (ruleRows.rows !== null && !rules);
  if (officesFailed || (archon && rulesFailed))
    return (
      <LoadProblem
        heading={title}
        onRetry={() => Promise.all([officeRows.reload(), ruleRows.reload()])}
      />
    );
  if (!archon || !rules || rules.models.length === 0) return null;

  const chosen = model && rules.models.includes(model) ? model : rules.models[0];
  if (!chosen) return null;
  const bounds = rules.bounds;
  const field = (name: string) => fields[name] ?? '';
  const set = (name: string) => (event: { target: { value: string } }) =>
    setFields({ ...fields, [name]: event.target.value });
  /** Problème d'une saisie sur un champ entier (`typedIntegerProblem`) ; `null` sur un champ décimal. */
  const problem = (name: keyof typeof PARAMS) =>
    INTEGERS.has(name) ? typedIntegerProblem(field(name), i18n.language) : null;
  /** Nombre saisi dans un champ ; refusé sur un champ entier : `NaN`, et rien ne part. */
  const value = (name: keyof typeof PARAMS) => (problem(name) ? NaN : read(field(name)));
  const picked = goods ?? [];
  const candidate: unknown =
    chosen === 'market_tax_rate'
      ? { rateBps: Math.round(value('rate') * 100) }
      : chosen === 'port_dues'
        ? { coefficientBps: Math.round(value('factor') * BPS) }
        : chosen === 'public_works'
          ? { amountOboles: value('amount') }
          : { amountOboles: value('amount'), days: value('days'), goodIds: picked };
  // Le schéma de l'API juge tout ; chaque champ se juge seul : le message tombe sous le champ fautif.
  const { proposal, faulty } = checkDecreeParams(bounds, chosen, candidate);
  const spending = chosen === 'festival' ? bounds.festival : bounds.public_works;
  const fits = (name: keyof typeof PARAMS) => field(name) !== '' && !faulty.has(PARAMS[name]);
  // Une saisie illisible, ambiguë ou décimale sur un champ entier a son propre message : ce n'est pas un
  // nombre hors des bornes.
  const invalid = (name: keyof typeof PARAMS) =>
    field(name) === ''
      ? undefined
      : problem(name)
        ? t(`decreeForm.${problem(name)}`)
        : Number.isNaN(read(field(name)))
          ? t('decreeForm.unreadable')
          : faulty.has(PARAMS[name])
            ? t('decreeForm.outOfBounds')
            : undefined;
  // Aucun bien coché n'est dit qu'une fois la fête entamée, comme un champ n'est jugé qu'une fois rempli.
  const started = goods !== null || field('amount') !== '' || field('days') !== '';
  const goodsInvalid = !faulty.has('goodIds')
    ? undefined
    : picked.length > 0
      ? t('decreeForm.tooManyGoods')
      : started
        ? t('decreeForm.noGoods')
        : undefined;

  async function propose() {
    if (busy || !proposal) return;
    setBusy(true);
    setNotice(null);
    setRefusal(null);
    const intent = JSON.stringify(proposal);
    const key = keys.current.get(intent) ?? crypto.randomUUID();
    keys.current.set(intent, key);
    try {
      const result = await cityCommand('city.proposeDecree', proposal, house.accessToken, key);
      if (result.ok || result.error.code !== 'INTERNAL') keys.current.delete(intent);
      await props.onDone();
      if (result.ok) {
        setFields({});
        setGoods(null);
        setOpen(false);
        setNotice({ kind: 'status', text: t('decreeForm.done') });
      } else setRefusal(t([`errors.${result.error.code}`, 'errors.INTERNAL']));
    } finally {
      setBusy(false);
    }
  }

  const tax = bounds.market_tax_rate;
  const port = bounds.port_dues;
  const festival = bounds.festival;
  const rulesText = t('decreeForm.rules', {
    count: rules.votingDays,
    quorum: percent.format(rules.quorumBps / BPS),
    open: rules.maxOpenPerCity,
    cap: percent.format(rules.spendingCapShareBps / BPS),
  });
  const named = (good: string) => t(`goods.${good}`, { defaultValue: good });
  // Récapitulatif chiffré : le modèle, puis chaque paramètre tel qu'il partira.
  const shown = (param: string, value: unknown) =>
    Array.isArray(value)
      ? new Intl.ListFormat(i18n.language).format(value.map((good) => named(String(good))))
      : param === 'rateBps' || param === 'coefficientBps'
        ? (param === 'rateBps' ? percent : factor).format(Number(value) / BPS)
        : param === 'amountOboles'
          ? money(Number(value))
          : number.format(Number(value));
  const recap = proposal
    ? [
        [t('decreeForm.model'), t(`decreeForm.models.${proposal.model}`)],
        ...Object.entries(proposal.params).map(([param, value]) => [
          t(`decreeForm.recap.${param}`),
          shown(param, value),
        ]),
      ]
    : [];
  const icons = {
    market_tax_rate: <Coins />,
    port_dues: <Ship />,
    public_works: <Hammer />,
    festival: <PartyPopper />,
  };
  const modelStep = (
    <fieldset className="flex flex-col gap-2">
      <legend className="sr-only">{t('decreeForm.model')}</legend>
      {rules.models.map((option) => (
        <label key={option} className={CHOICE}>
          <input
            className="mt-1 size-5 shrink-0 accent-primary"
            type="radio"
            name="decree-model"
            checked={option === chosen}
            onChange={() => setModel(option)}
            aria-labelledby={`${goodsError}-${option}`}
            aria-describedby={`${goodsError}-${option}-about`}
          />
          <span aria-hidden="true" className="mt-0.5 text-accent [&_svg]:size-5">
            {icons[option]}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span id={`${goodsError}-${option}`} className="font-medium">
              {t(`decreeForm.models.${option}`)}
            </span>
            <span id={`${goodsError}-${option}-about`} className="text-sm text-muted-foreground">
              {t(`decreeForm.about.${option}`)}
            </span>
          </span>
        </label>
      ))}
    </fieldset>
  );
  const paramsStep = (
    <div className="flex flex-col gap-4">
      {chosen === 'market_tax_rate' && tax && (
        <Field
          label={t('decreeForm.rate')}
          hint={t('decreeForm.between', {
            min: percent.format(tax.minRateBps / BPS),
            max: percent.format(tax.maxRateBps / BPS),
          })}
          error={invalid('rate')}
          inputMode="decimal"
          value={field('rate')}
          onChange={set('rate')}
        />
      )}
      {chosen === 'port_dues' && port && (
        <Field
          label={t('decreeForm.factor')}
          hint={t('decreeForm.between', {
            min: factor.format(port.minCoefficientBps / BPS),
            max: factor.format(port.maxCoefficientBps / BPS),
          })}
          error={invalid('factor')}
          inputMode="decimal"
          value={field('factor')}
          onChange={set('factor')}
        />
      )}
      {(chosen === 'public_works' || chosen === 'festival') && spending && (
        <Field
          label={t('decreeForm.amount')}
          hint={[
            t('decreeForm.betweenOboles', {
              min: number.format(spending.minOboles),
              max: number.format(spending.maxOboles),
              minMoney: money(spending.minOboles),
              maxMoney: money(spending.maxOboles),
            }),
            fits('amount') && t('decreeForm.amountIs', { amount: money(value('amount')) }),
          ]
            .filter(Boolean)
            .join(' ')}
          error={invalid('amount')}
          inputMode="numeric"
          value={field('amount')}
          onChange={set('amount')}
        />
      )}
      {chosen === 'festival' && festival && (
        <>
          <Field
            label={t('decreeForm.days')}
            hint={t('decreeForm.between', {
              min: number.format(festival.minDays),
              max: number.format(festival.maxDays),
            })}
            error={invalid('days')}
            inputMode="numeric"
            value={field('days')}
            onChange={set('days')}
          />
          <fieldset
            className="grid grid-cols-2 gap-2"
            aria-describedby={goodsError}
            aria-invalid={goodsInvalid ? true : undefined}
          >
            <legend className="mb-1 font-medium">
              {t('decreeForm.goods', { count: festival.maxGoods })}
            </legend>
            {festival.goodIds.map((good) => (
              <label key={good} className={`${CHOICE} min-h-11 items-center py-0`}>
                <input
                  className="size-5 accent-primary"
                  type="checkbox"
                  checked={picked.includes(good)}
                  onChange={(event) =>
                    setGoods(
                      event.target.checked ? [...picked, good] : picked.filter((g) => g !== good),
                    )
                  }
                />
                {t(`goods.${good}`, { defaultValue: good })}
              </label>
            ))}
            {/* Région toujours présente : le message qui y paraît est annoncé. */}
            <p
              id={goodsError}
              role="alert"
              className="col-span-2 text-sm font-semibold text-danger"
            >
              {goodsInvalid}
            </p>
          </fieldset>
        </>
      )}
    </div>
  );
  const recapStep = (
    <div className="flex flex-col gap-3">
      <dl className="divide-y divide-border-subtle rounded-lg border border-border-subtle px-3 tabular-nums">
        {recap.map(([term = '', value]) => (
          <div key={term} className="flex flex-wrap justify-between gap-x-4 py-2">
            <dt className="text-muted-foreground">{term}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      <StatusRegion role="alert" tone="danger">
        {refusal}
      </StatusRegion>
    </div>
  );

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-border-subtle bg-surface-raised p-4 shadow-sm">
      <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
        <h3 ref={title} tabIndex={-1} className="flex items-center gap-2 font-semibold">
          <Scroll aria-hidden="true" className="size-5 shrink-0 text-accent" />
          {t('decreeForm.title')}
        </h3>
        <p className="text-sm text-muted-foreground">{rulesText}</p>
      </div>
      <Button icon={<Scroll />} onClick={() => setOpen(true)}>
        {t('decreeForm.open')}
      </Button>
      <StatusRegion ref={noticeElement} tone="success" className="-mt-3 basis-full has-[p]:mt-0">
        {notice?.text}
      </StatusRegion>
      <Sheet
        open={open}
        onClose={() => {
          if (busy) return;
          setRefusal(null);
          setOpen(false);
        }}
        closeDisabled={busy}
        title={t('decreeForm.title')}
        description={t('decreeForm.intro', { city: house.cityName })}
        closeLabel={t('shell.close')}
      >
        <Stepper
          confirming={busy}
          onConfirm={() => void propose()}
          labels={{
            progress: t('stepper.progress'),
            back: t('stepper.back'),
            next: t('stepper.next'),
            confirm: t('decreeForm.submit'),
            stepOf: (current, total) =>
              t('stepper.stepOf', { current: number.format(current), total: number.format(total) }),
          }}
          steps={[
            { id: 'model', title: t('decreeForm.stepModel'), content: modelStep },
            {
              id: 'params',
              title: t('decreeForm.stepParams'),
              content: paramsStep,
              valid: proposal !== null,
            },
            { id: 'recap', title: t('decreeForm.stepRecap'), content: recapStep },
          ]}
        />
      </Sheet>
    </div>
  );
}
