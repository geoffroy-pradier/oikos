import { NumberField, Sheet, StatusRegion, Stepper } from '@oikos/ui';
import { splitLoanRepayment } from '@oikos/sim';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { repayLoan } from '../api';
import { useHouse } from '../house';
import type { MyLoan } from '../loans';
import { useMoney } from '../money';
import { useStepperLabels } from '../stepper-labels';

/** Saisie vide : rien à rembourser ; sinon ce qui est tapé (`NaN` : illisible). */
const amount = (typed: number | null | undefined) => (typed == null ? 0 : typed);

/**
 * Feuille de remboursement d'un prêt (5.4, ADR 0011), en deux étapes : le montant (boutons ± et raccourcis, borné par
 * le reste dû et la trésorerie lue), puis le récapitulatif chiffré, intérêts d'abord, dont la confirmation envoie le
 * montant vu. L'API relit le prêt : un reste dû qui a changé est refusé (`ABOVE_OUTSTANDING`), rien n'est alors payé,
 * la feuille reste ouverte et l'écran relit. La même intention restée sans réponse repart sous la même clé.
 */
export function LoanRepaySheet(props: {
  loan: MyLoan;
  /** Trésorerie de la maison en oboles ; `null` tant qu'elle n'est pas lue : l'API refuse alors un montant trop haut. */
  treasury: number | null;
  open: boolean;
  onClose: () => void;
  /** Remboursement fait : le message, annoncé sur l'écran ; l'écran relit ses lectures. */
  onRepaid: (message: string) => Promise<unknown>;
  /** Refus : relire (le reste dû a pu changer). */
  onRefused: () => Promise<unknown>;
}) {
  const { loan, treasury } = props;
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const money = useMoney();
  const steps = useStepperLabels();
  const number = new Intl.NumberFormat(i18n.language);
  const [typed, setTyped] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const keys = useRef(new Map<string, string>());
  const running = useRef(false);
  const limit = treasury === null ? loan.outstanding : Math.min(loan.outstanding, treasury);
  const value = amount(typed);
  const valid = Number.isSafeInteger(value) && value >= 1 && value <= limit;
  const split = valid ? splitLoanRepayment(BigInt(value), BigInt(loan.interestDue)) : null;
  const left = valid ? loan.outstanding - value : null;
  const lender = t(`finances.debts.lender.${loan.lender}`);

  async function repay() {
    if (!valid || running.current) return;
    running.current = true;
    setBusy(true);
    setRefusal(null);
    const input = { loanId: loan.id, amount: value };
    const intent = JSON.stringify(input);
    const key = keys.current.get(intent) ?? crypto.randomUUID();
    keys.current.set(intent, key);
    try {
      const result = await repayLoan(input, house.accessToken, key);
      // Sans réponse (réseau), la même clé repart ; toute autre issue est connue.
      if (result.ok || result.error.code !== 'INTERNAL') keys.current.delete(intent);
      if (result.ok) {
        setTyped(null);
        props.onClose();
        await props.onRepaid(
          t(result.data.outstanding === 0 ? 'finances.repay.doneSettled' : 'finances.repay.done', {
            amount: money(result.data.interest + result.data.principal),
            left: money(result.data.outstanding),
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

  const line = (term: string, text: string, strong = false) => (
    <div
      key={term}
      className={`flex flex-wrap justify-between gap-x-4 py-2 ${strong ? 'font-semibold' : ''}`}
    >
      <dt className={strong ? '' : 'text-muted-foreground'}>{term}</dt>
      <dd>{text}</dd>
    </div>
  );
  const amountStep = (
    <div className="flex flex-col gap-4">
      <dl className="divide-y divide-border-subtle rounded-lg border border-border-subtle px-3 tabular-nums">
        {line(t('finances.debts.outstanding'), money(loan.outstanding), true)}
        {line(t('finances.debts.interest'), money(loan.interestDue))}
        {treasury !== null && line(t('finances.repay.treasury'), money(treasury))}
      </dl>
      {limit > 0 ? (
        <NumberField
          label={t('finances.repay.amount')}
          hint={t('finances.repay.amountHint', { max: number.format(limit) })}
          locale={i18n.language}
          min={1}
          max={limit}
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
      ) : (
        <p className="rounded-lg bg-muted p-3 text-sm">{t('finances.repay.noFunds')}</p>
      )}
      <StatusRegion role="alert" tone="danger">
        {limit > 0 &&
          typed !== null &&
          !valid &&
          t('finances.repay.outOfBounds', { max: number.format(limit) })}
      </StatusRegion>
      <p className="text-sm text-muted-foreground">{t('finances.repay.order')}</p>
    </div>
  );
  const recapStep = (
    <div className="flex flex-col gap-3">
      {split && left !== null && (
        <>
          <p className="font-medium">{t('finances.repay.recap', { lender })}</p>
          <dl className="divide-y divide-border-subtle rounded-lg border border-border-subtle px-3 tabular-nums">
            {line(t('finances.repay.recapInterest'), money(Number(split.interest)))}
            {line(t('finances.repay.recapPrincipal'), money(Number(split.principal)))}
            {line(t('finances.repay.recapTotal'), money(value), true)}
            {line(t('finances.repay.recapLeft'), money(left))}
            {treasury !== null && line(t('finances.repay.recapTreasury'), money(treasury - value))}
          </dl>
          <p className="text-sm text-muted-foreground">
            {t(left === 0 ? 'finances.repay.recapSettles' : 'finances.repay.recapNote')}
          </p>
        </>
      )}
      {!split && <p className="rounded-lg bg-muted p-3 text-sm">{t('finances.repay.changed')}</p>}
      <StatusRegion role="alert" tone="danger">
        {refusal}
      </StatusRegion>
    </div>
  );

  return (
    <Sheet
      open={props.open}
      onClose={() => !busy && props.onClose()}
      title={t('finances.repay.title')}
      description={lender}
      closeLabel={t('shell.close')}
      closeDisabled={busy}
    >
      <Stepper
        confirming={busy}
        onConfirm={() => void repay()}
        labels={{
          ...steps,
          confirm: t('finances.repay.confirm', { amount: money(valid ? value : 0) }),
        }}
        steps={[
          {
            id: 'amount',
            title: t('finances.repay.stepAmount'),
            content: amountStep,
            valid,
          },
          { id: 'recap', title: t('finances.repay.stepRecap'), content: recapStep },
        ]}
      />
    </Sheet>
  );
}
