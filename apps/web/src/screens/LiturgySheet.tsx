import { NumberField, Sheet, StatusRegion, Stepper } from '@oikos/ui';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { performLiturgy } from '../api';
import { useHouse } from '../house';
import { quoteLiturgy, splendorLimit, type LiturgyRules, type MyLiturgy } from '../liturgies';
import { useMoney } from '../money';
import { useStepperLabels } from '../stepper-labels';

/** Saisie vide : aucun faste ; sinon ce qui est tapé (`NaN` : illisible). */
const amount = (typed: number | null | undefined) => (typed == null ? 0 : typed);

/**
 * Feuille d'accomplissement d'une liturgie (6.4, ADR 0011), en trois étapes : le dû vu, le faste (boutons ± et
 * raccourcis, bornés par la configuration) avec la Timè et la Charis annoncées, puis le récapitulatif chiffré dont
 * la confirmation envoie le dû vu. L'API refuse un dû qui a changé (`PRICE_CHANGED`) : rien n'est alors payé, la
 * feuille reste ouverte et l'écran relit. La même intention restée sans réponse repart sous la même clé.
 */
export function LiturgySheet(props: {
  liturgy: MyLiturgy;
  rules: LiturgyRules;
  /** Dieu protecteur de la cité, qui reçoit la Charis ; `null` : aucun. */
  godName: string | null;
  open: boolean;
  onClose: () => void;
  /** Liturgie accomplie : le message, annoncé sur l'écran ; l'écran relit ses lectures. */
  onPerformed: (message: string) => Promise<unknown>;
  /** Refus : relire (le dû a pu changer). */
  onRefused: () => Promise<unknown>;
}) {
  const { liturgy, rules } = props;
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
  const limit = splendorLimit(liturgy.due, rules);
  const splendor = amount(typed);
  const quote = quoteLiturgy(liturgy.due, splendor, rules);
  const genre = t(`liturgy.genres.${liturgy.genre}`);
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });

  async function perform() {
    if (!quote || running.current) return;
    running.current = true;
    setBusy(true);
    setRefusal(null);
    const input = { liturgyId: liturgy.id, expectedDue: liturgy.due, splendor };
    const intent = JSON.stringify(input);
    const key = keys.current.get(intent) ?? crypto.randomUUID();
    keys.current.set(intent, key);
    try {
      const result = await performLiturgy(input, house.accessToken, key);
      // Sans réponse (réseau), la même clé repart ; toute autre issue est connue.
      if (result.ok || result.error.code !== 'INTERNAL') keys.current.delete(intent);
      if (result.ok) {
        setTyped(null);
        props.onClose();
        await props.onPerformed(
          t('liturgy.done', {
            total: money(result.data.due + result.data.splendor),
            honor: number.format(result.data.honorGained),
            charis: number.format(result.data.charisGained),
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

  const line = (term: string, value: string, strong = false) => (
    <div
      key={term}
      className={`flex flex-wrap justify-between gap-x-4 py-2 ${strong ? 'font-semibold' : ''}`}
    >
      <dt className={strong ? '' : 'text-muted-foreground'}>{term}</dt>
      <dd>{value}</dd>
    </div>
  );
  const dueStep = (
    <div className="flex flex-col gap-3">
      <p className="font-medium">{genre}</p>
      <dl className="divide-y divide-border-subtle rounded-lg border border-border-subtle px-3 tabular-nums">
        {line(t('liturgy.due'), money(liturgy.due), true)}
        {line(t('liturgy.deadline'), date.format(liturgy.dueAt))}
      </dl>
      <p className="text-sm text-muted-foreground">{t('liturgy.sheet.dueNote')}</p>
    </div>
  );
  const splendorStep = (
    <div className="flex flex-col gap-4">
      {limit > 0 ? (
        <NumberField
          label={t('liturgy.sheet.splendor')}
          hint={t('liturgy.sheet.splendorHint', { max: number.format(limit) })}
          locale={i18n.language}
          min={0}
          max={limit}
          labels={{
            decrement: t('controls.decrement'),
            increment: t('controls.increment'),
            all: t('controls.all'),
            shortcuts: t('controls.shortcuts'),
          }}
          value={typed}
          onValueChange={(value) => {
            setTyped(value);
            setRefusal(null);
          }}
        />
      ) : (
        <p className="rounded-lg bg-muted p-3 text-sm">{t('liturgy.sheet.noSplendor')}</p>
      )}
      <StatusRegion role="alert" tone="danger">
        {quote === null && t('liturgy.sheet.outOfBounds', { max: number.format(limit) })}
      </StatusRegion>
      <p aria-live="polite" className="rounded-lg bg-accent-subtle px-3 py-2 text-sm font-medium">
        {quote &&
          t(props.godName ? 'liturgy.sheet.quote' : 'liturgy.sheet.quoteNoGod', {
            honor: number.format(quote.honor),
            charis: number.format(quote.charis),
            god: props.godName,
          })}
      </p>
    </div>
  );
  const recapStep = quote && (
    <div className="flex flex-col gap-3">
      <p className="font-medium">{t('liturgy.sheet.recap', { genre })}</p>
      <dl className="divide-y divide-border-subtle rounded-lg border border-border-subtle px-3 tabular-nums">
        {line(t('liturgy.sheet.recapDue'), money(liturgy.due))}
        {line(t('liturgy.sheet.recapSplendor'), money(splendor))}
        {line(t('liturgy.sheet.recapTotal'), money(quote.total), true)}
        {line(t('liturgy.sheet.recapHonor'), `+${number.format(quote.honor)}`)}
        {line(
          props.godName
            ? t('liturgy.sheet.recapCharis', { god: props.godName })
            : t('liturgy.sheet.recapCharisNoGod'),
          `+${number.format(props.godName ? quote.charis : 0)}`,
        )}
      </dl>
      <p className="text-sm text-muted-foreground">{t('liturgy.sheet.recapNote')}</p>
      <StatusRegion role="alert" tone="danger">
        {refusal}
      </StatusRegion>
    </div>
  );

  return (
    <Sheet
      open={props.open}
      onClose={() => !busy && props.onClose()}
      title={t('liturgy.sheet.title')}
      description={genre}
      closeLabel={t('shell.close')}
      closeDisabled={busy}
    >
      <Stepper
        confirming={busy}
        onConfirm={() => void perform()}
        labels={{
          ...steps,
          confirm: t('liturgy.sheet.confirm', { total: money(quote?.total ?? liturgy.due) }),
        }}
        steps={[
          { id: 'due', title: t('liturgy.sheet.stepDue'), content: dueStep },
          {
            id: 'splendor',
            title: t('liturgy.sheet.stepSplendor'),
            content: splendorStep,
            valid: quote !== null,
          },
          { id: 'recap', title: t('liturgy.sheet.stepRecap'), content: recapStep },
        ]}
      />
    </Sheet>
  );
}
