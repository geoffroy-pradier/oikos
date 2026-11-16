import type { DecreeModel } from '@oikos/contracts';
import { Button, Field } from '@oikos/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cityCommand } from '../api';
import { useRows } from '../data';
import { checkDecreeParams, parseDecreeRules, readTypedNumber } from '../decrees';
import { useHouse } from '../house';
import { useMoney } from '../money';
import { parseOffices } from '../politics';
import { LoadProblem } from './LoadProblem';

type Notice = { kind: 'status' | 'alert'; text: string } | null;
const WAITING = 'aria-disabled:cursor-not-allowed aria-disabled:opacity-60';
const BPS = 10_000;
/** Paramètre du décret que porte chaque champ saisi. */
const PARAMS = { rate: 'rateBps', factor: 'coefficientBps', amount: 'amountOboles', days: 'days' };

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
  const [model, setModel] = useState<DecreeModel | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  // `null` : aucune case encore touchée.
  const [goods, setGoods] = useState<string[] | null>(null);
  const goodsError = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const keys = useRef(new Map<string, string>());
  const noticeElement = useRef<HTMLParagraphElement>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  useEffect(() => {
    const active = document.activeElement;
    if (notice && (active === document.body || active?.getAttribute('aria-disabled') === 'true'))
      noticeElement.current?.focus();
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
  const picked = goods ?? [];
  const candidate: unknown =
    chosen === 'market_tax_rate'
      ? { rateBps: Math.round(read(field('rate')) * 100) }
      : chosen === 'port_dues'
        ? { coefficientBps: Math.round(read(field('factor')) * BPS) }
        : chosen === 'public_works'
          ? { amountOboles: read(field('amount')) }
          : { amountOboles: read(field('amount')), days: read(field('days')), goodIds: picked };
  // Le schéma de l'API juge tout ; chaque champ se juge seul : le message tombe sous le champ fautif.
  const { proposal, faulty } = checkDecreeParams(bounds, chosen, candidate);
  const spending = chosen === 'festival' ? bounds.festival : bounds.public_works;
  const fits = (name: keyof typeof PARAMS) => field(name) !== '' && !faulty.has(PARAMS[name]);
  // Une saisie illisible a son propre message : ce n'est pas un nombre hors des bornes.
  const invalid = (name: keyof typeof PARAMS) =>
    field(name) === ''
      ? undefined
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
    const intent = JSON.stringify(proposal);
    const key = keys.current.get(intent) ?? crypto.randomUUID();
    keys.current.set(intent, key);
    try {
      const result = await cityCommand('city.proposeDecree', proposal, house.accessToken, key);
      if (result.ok || result.error.code !== 'INTERNAL') keys.current.delete(intent);
      if (result.ok) {
        setFields({});
        setGoods(null);
      }
      setNotice(
        result.ok
          ? { kind: 'status', text: t('decreeForm.done') }
          : { kind: 'alert', text: t([`errors.${result.error.code}`, 'errors.INTERNAL']) },
      );
      await props.onDone();
    } finally {
      setBusy(false);
    }
  }

  const tax = bounds.market_tax_rate;
  const port = bounds.port_dues;
  const festival = bounds.festival;
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      <h3 ref={title} tabIndex={-1} className="font-semibold">
        {t('decreeForm.title')}
      </h3>
      <p className="text-muted-foreground">
        {t('decreeForm.rules', {
          count: rules.votingDays,
          quorum: percent.format(rules.quorumBps / BPS),
          open: rules.maxOpenPerCity,
          cap: percent.format(rules.spendingCapShareBps / BPS),
        })}
      </p>
      <fieldset className="flex flex-col gap-1">
        <legend className="font-medium">{t('decreeForm.model')}</legend>
        {rules.models.map((option) => (
          <label key={option} className="flex items-center gap-2">
            <input
              type="radio"
              name="decree-model"
              checked={option === chosen}
              onChange={() => setModel(option)}
            />
            {t(`decreeForm.models.${option}`)}
          </label>
        ))}
      </fieldset>
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
            fits('amount') && t('decreeForm.amountIs', { amount: money(read(field('amount'))) }),
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
            className="flex flex-col gap-1"
            aria-describedby={goodsError}
            aria-invalid={goodsInvalid ? true : undefined}
          >
            <legend className="font-medium">
              {t('decreeForm.goods', { count: festival.maxGoods })}
            </legend>
            {festival.goodIds.map((good) => (
              <label key={good} className="flex items-center gap-2">
                <input
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
            <p id={goodsError} role="alert" className="text-sm font-semibold text-danger">
              {goodsInvalid}
            </p>
          </fieldset>
        </>
      )}
      <Button
        className={`self-start ${WAITING}`}
        aria-disabled={busy || proposal === null}
        onClick={() => void propose()}
      >
        {t('decreeForm.submit')}
      </Button>
      <p
        ref={noticeElement}
        tabIndex={-1}
        role={notice?.kind ?? 'status'}
        className={notice?.kind === 'alert' ? 'font-semibold text-danger' : ''}
      >
        {notice?.text ?? ''}
      </p>
    </div>
  );
}
