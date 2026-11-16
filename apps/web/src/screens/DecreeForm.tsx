import {
  boundedDecreeParamsSchemas,
  type DecreeModel,
  type DecreeProposal,
} from '@oikos/contracts';
import { Button, Field } from '@oikos/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cityCommand } from '../api';
import { useRows } from '../data';
import { parseDecreeRules } from '../decrees';
import { useHouse } from '../house';
import { useMoney } from '../money';
import { parseOffices } from '../politics';

type Notice = { kind: 'status' | 'alert'; text: string } | null;
const WAITING = 'aria-disabled:cursor-not-allowed aria-disabled:opacity-60';
const BPS = 10_000;

/** Nombre saisi : décimal (virgule ou point) pour un taux ou un coefficient, entier pour le reste. */
const read = (typed: string) => (typed.trim() === '' ? NaN : Number(typed.replace(',', '.')));

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
  const [goods, setGoods] = useState<string[]>([]);
  const keys = useRef(new Map<string, string>());
  const noticeElement = useRef<HTMLParagraphElement>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  useEffect(() => {
    const active = document.activeElement;
    if (notice && (active === document.body || active?.getAttribute('aria-disabled') === 'true'))
      noticeElement.current?.focus();
  }, [notice]);
  if (!archon || !rules || rules.models.length === 0) return null;

  const chosen = model && rules.models.includes(model) ? model : rules.models[0];
  if (!chosen) return null;
  const bounds = rules.bounds;
  const field = (name: string) => fields[name] ?? '';
  const set = (name: string) => (event: { target: { value: string } }) =>
    setFields({ ...fields, [name]: event.target.value });
  const proposal = ((): DecreeProposal | null => {
    const candidate: unknown =
      chosen === 'market_tax_rate'
        ? { rateBps: Math.round(read(field('rate')) * 100) }
        : chosen === 'port_dues'
          ? { coefficientBps: Math.round(read(field('factor')) * BPS) }
          : chosen === 'public_works'
            ? { amountOboles: read(field('amount')) }
            : { amountOboles: read(field('amount')), days: read(field('days')), goodIds: goods };
    const parsed = boundedDecreeParamsSchemas(bounds)[chosen]?.safeParse(candidate);
    return parsed?.success ? ({ model: chosen, params: parsed.data } as DecreeProposal) : null;
  })();
  const invalid = (name: string) =>
    field(name) !== '' && proposal === null ? t('decreeForm.outOfBounds') : undefined;

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
      if (result.ok) setFields({});
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
  const spend = chosen === 'festival' ? bounds.festival : bounds.public_works;
  const festival = bounds.festival;
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      <h3 className="font-semibold">{t('decreeForm.title')}</h3>
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
      {(chosen === 'public_works' || chosen === 'festival') && spend && (
        <Field
          label={t('decreeForm.amount')}
          hint={t('decreeForm.between', {
            min: money(spend.minOboles),
            max: money(spend.maxOboles),
          })}
          error={chosen === 'public_works' ? invalid('amount') : undefined}
          inputMode="numeric"
          value={field('amount')}
          onChange={set('amount')}
        />
      )}
      {chosen === 'festival' && festival && (
        <>
          <Field
            label={t('decreeForm.days')}
            hint={t('decreeForm.between', { min: festival.minDays, max: festival.maxDays })}
            error={invalid('days')}
            inputMode="numeric"
            value={field('days')}
            onChange={set('days')}
          />
          <fieldset className="flex flex-col gap-1">
            <legend className="font-medium">
              {t('decreeForm.goods', { count: festival.maxGoods })}
            </legend>
            {festival.goodIds.map((good) => (
              <label key={good} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={goods.includes(good)}
                  onChange={(event) =>
                    setGoods(
                      event.target.checked ? [...goods, good] : goods.filter((g) => g !== good),
                    )
                  }
                />
                {t(`goods.${good}`, { defaultValue: good })}
              </label>
            ))}
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
