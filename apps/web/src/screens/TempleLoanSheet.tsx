import { NumberField, SegmentedControl, Sheet, StatusRegion, Stepper } from '@oikos/ui';
import { templeLoanInterest } from '@oikos/sim';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { borrowFromTemple } from '../api';
import { useHouse } from '../house';
import type { TempleRules } from '../loans';
import { useMoney } from '../money';
import { useStepperLabels } from '../stepper-labels';

/**
 * Feuille d'emprunt au Trésor du temple (5.4, ADR 0011), en trois étapes : montant borné par le plafond de la Timè,
 * durée admise avec ses intérêts (`templeLoanInterest`, packages/sim), puis récapitulatif chiffré dont la confirmation
 * envoie le taux vu. Un taux changé est refusé (`RATE_CHANGED`) : feuille ouverte, l'écran relit.
 */
export function TempleLoanSheet(props: {
  rules: TempleRules;
  cap: number;
  open: boolean;
  onClose: () => void;
  onBorrowed: (message: string) => Promise<unknown>;
  onRefused: () => Promise<unknown>;
}) {
  const { rules, cap } = props;
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const money = useMoney();
  const steps = useStepperLabels();
  const number = new Intl.NumberFormat(i18n.language);
  const percent = new Intl.NumberFormat(i18n.language, {
    style: 'percent',
    maximumFractionDigits: 2,
  });
  const rate = percent.format(rules.policyRateBps / 10_000);
  const [typed, setTyped] = useState<number | null>(null);
  const [term, setTerm] = useState(rules.termDays[0] ?? 0);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const keys = useRef(new Map<string, string>());
  const running = useRef(false);
  const principal = typed == null ? 0 : typed;
  const valid = Number.isSafeInteger(principal) && principal >= 1 && principal <= cap;
  const termOk = rules.termDays.includes(term);
  const interestFor = (days: number) =>
    valid ? Number(templeLoanInterest(BigInt(principal), rules.policyRateBps, days)) : null;
  const interest = termOk ? interestFor(term) : null;
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });

  async function borrow() {
    if (interest === null || running.current) return;
    running.current = true;
    setBusy(true);
    setRefusal(null);
    const input = { principal, termDays: term, expectedRateBps: rules.policyRateBps };
    const intent = JSON.stringify(input);
    const key = keys.current.get(intent) ?? crypto.randomUUID();
    keys.current.set(intent, key);
    try {
      const result = await borrowFromTemple(input, house.accessToken, key);
      // Sans réponse (réseau), la même clé repart ; toute autre issue est connue.
      if (result.ok || result.error.code !== 'INTERNAL') keys.current.delete(intent);
      if (result.ok) {
        setTyped(null);
        props.onClose();
        await props.onBorrowed(
          t('finances.borrow.done', {
            principal: money(result.data.principal),
            total: money(result.data.outstanding),
            date: date.format(Date.parse(result.data.dueAt)),
          }),
        );
      } else {
        setRefusal(t([`errors.${result.error.code}`, 'errors.INTERNAL']));
        await props.onRefused();
      }
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  const line = (name: string, text: string, strong = false) => (
    <div
      key={name}
      className={`flex flex-wrap justify-between gap-x-4 py-2 ${strong ? 'font-semibold' : ''}`}
    >
      <dt className={strong ? '' : 'text-muted-foreground'}>{name}</dt>
      <dd>{text}</dd>
    </div>
  );
  const amountStep = (
    <div className="flex flex-col gap-4">
      <NumberField
        label={t('finances.borrow.amount')}
        hint={t('finances.borrow.amountHint', { max: number.format(cap) })}
        locale={i18n.language}
        min={1}
        max={cap}
        labels={{
          decrement: t('controls.decrement'),
          increment: t('controls.increment'),
          all: t('controls.all'),
          shortcuts: t('controls.shortcuts'),
        }}
        value={typed}
        onValueChange={(next) => {
          setTyped(next);
          setRefusal(null);
        }}
      />
      <StatusRegion role="alert" tone="danger">
        {typed !== null && !valid && t('finances.borrow.outOfBounds', { max: number.format(cap) })}
      </StatusRegion>
    </div>
  );
  const termStep = (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t('finances.borrow.termHint')}</p>
      <SegmentedControl
        label={t('finances.borrow.term')}
        value={String(term)}
        onValueChange={(value) => setTerm(Number(value))}
        options={rules.termDays.map((days) => ({
          value: String(days),
          label: t('finances.borrow.daysShort', { count: days }),
        }))}
      />
      <p aria-live="polite" className="rounded-lg bg-accent-subtle px-3 py-2 text-sm font-medium">
        {interest !== null &&
          t('finances.borrow.quote', {
            rate,
            interest: money(interest),
            total: money(principal + interest),
          })}
      </p>
    </div>
  );
  const recapStep = (
    <div className="flex flex-col gap-3">
      {interest !== null && (
        <>
          <p className="font-medium">{t('finances.borrow.recap')}</p>
          <dl className="divide-y divide-border-subtle rounded-lg border border-border-subtle px-3 tabular-nums">
            {line(t('finances.borrow.recapPrincipal'), money(principal))}
            {line(t('finances.borrow.recapTerm'), t('finances.borrow.days', { count: term }))}
            {line(t('finances.borrow.recapRate'), t('finances.borrow.perYear', { rate }))}
            {line(t('finances.borrow.recapInterest'), money(interest))}
            {line(t('finances.borrow.recapTotal'), money(principal + interest), true)}
            {line(t('finances.borrow.recapDue'), t('finances.borrow.dueIn', { count: term }))}
          </dl>
          <p className="text-sm text-muted-foreground">{t('finances.borrow.recapNote')}</p>
        </>
      )}
      <StatusRegion role="alert" tone="danger">
        {refusal}
      </StatusRegion>
    </div>
  );

  return (
    <Sheet
      open={props.open}
      onClose={() => !busy && props.onClose()}
      title={t('finances.borrow.title')}
      closeLabel={t('shell.close')}
      closeDisabled={busy}
    >
      <Stepper
        confirming={busy}
        onConfirm={() => void borrow()}
        labels={{
          ...steps,
          confirm: t('finances.borrow.confirm', { amount: money(valid ? principal : 0), rate }),
        }}
        steps={[
          { id: 'amount', title: t('finances.borrow.stepAmount'), content: amountStep, valid },
          { id: 'term', title: t('finances.borrow.stepTerm'), content: termStep, valid: termOk },
          { id: 'recap', title: t('finances.borrow.stepRecap'), content: recapStep },
        ]}
      />
    </Sheet>
  );
}
