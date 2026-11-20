import { MAX_STEWARD_INSTRUCTION_LENGTH, type StewardRule } from '@oikos/contracts';
import { Button } from '@oikos/ui';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useMoney } from '../money';
import type { Steward, StewardInstruction, StewardOperation } from '../stewards';

/**
 * Consigne en langage naturel d'un intendant (4.4, #280) : le joueur l'écrit, le moteur la traduit en règles et les
 * simule. La proposition se valide telle quelle (`steward.setRules`) ou se reprend dans le formulaire ; un refus le
 * dit et mène au formulaire, voie complète du jeu IA coupée. Une proposition d'une révision passée n'est plus montrée.
 */
export function SiteStewardInstruction(props: {
  steward: Steward;
  instruction: StewardInstruction | undefined;
  busy: boolean;
  /** Une opération en une phrase, comme les dernières opérations de la fiche. */
  describe: (operation: Omit<StewardOperation, 'tick' | 'revision'>) => string;
  /** Envoie la consigne ; vrai si elle est mise en file. */
  onSubmit: (text: string) => Promise<boolean>;
  /** Brouillon de la consigne, gardé par la fiche : il survit à la feuille refermée et à un échec. */
  draft: string;
  onDraft: (text: string) => void;
  onValidate: (rules: StewardRule[]) => void;
  onEdit: (rules: StewardRule[]) => void;
  onRefresh: () => void;
  openForm: () => void;
}) {
  const { t } = useTranslation();
  const money = useMoney();
  const { draft: text, onDraft: setText } = props;
  const { steward, instruction, busy } = props;
  const current = instruction?.revision === steward.revision ? instruction : undefined;
  const id = `instruction-${steward.id}`;
  const goodName = (good: string) => t(`goods.${good}`, { defaultValue: good });
  const ruleText = (rule: StewardRule) =>
    rule.kind === 'collect'
      ? t('steward.kinds.collect')
      : t(`steward.instruction.rules.${rule.kind}`, {
          good: goodName(rule.goodId),
          price: money(rule.kind === 'sell' ? rule.minPriceOboles : rule.maxPriceOboles),
          count: rule.kind === 'sell' ? rule.keepUnits : rule.targetUnits,
        });
  /** Ce que la règle ferait maintenant, selon la simulation à blanc. */
  const outcome = (rule: StewardRule, position: number) => {
    const step = current?.simulation?.find((candidate) => candidate.position === position);
    if (!step) return t('steward.instruction.unknown');
    if (step.status === 'idle') return t('steward.instruction.idle');
    return props.describe({
      at: new Date(0),
      status: step.status,
      code: step.status === 'rejected' ? step.code : null,
      kind: rule.kind,
      goodId: rule.kind === 'collect' ? null : rule.goodId,
      summary: step.summary,
    });
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = text.trim();
    if (busy || trimmed === '') return;
    if (await props.onSubmit(trimmed)) setText('');
  }

  return (
    <section aria-labelledby={id} className="flex flex-col gap-2 text-sm">
      <h5 id={id} className="font-semibold">
        {t('steward.instruction.title')}
      </h5>
      {current?.text && (
        <p className="break-words">{t('steward.instruction.quote', { text: current.text })}</p>
      )}
      {current?.status === 'pending' ? (
        <>
          <p>{t('steward.instruction.pending', { name: steward.name })}</p>
          <Button
            type="button"
            variant="secondary"
            className="self-start"
            onClick={props.onRefresh}
          >
            {t('steward.instruction.refresh')}
          </Button>
        </>
      ) : (
        <form className="flex flex-col gap-2" onSubmit={(event) => void submit(event)}>
          <label className="flex flex-col gap-1">
            <span>{t('steward.instruction.label', { name: steward.name })}</span>
            <textarea
              className="min-h-20 w-full rounded-md border border-border bg-surface px-3 py-2"
              maxLength={MAX_STEWARD_INSTRUCTION_LENGTH}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <p className="text-muted-foreground">{t('steward.instruction.hint')}</p>
          <Button
            type="submit"
            className="self-start aria-disabled:opacity-60"
            aria-disabled={busy || text.trim() === ''}
          >
            {t('steward.instruction.send')}
          </Button>
        </form>
      )}
      {current?.status === 'answered' && current.rules && (
        <div className="flex flex-col gap-2">
          <p className="font-semibold">
            {t('steward.instruction.proposed', { name: steward.name })}
          </p>
          <ol className="flex flex-col gap-1">
            {current.rules.map((rule, position) => (
              <li key={position} className="break-words">
                {t('steward.instruction.line', {
                  n: position + 1,
                  rule: ruleText(rule),
                  outcome: outcome(rule, position),
                })}
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="aria-disabled:opacity-60"
              aria-disabled={busy}
              onClick={() => current.rules && !busy && props.onValidate(current.rules)}
            >
              {t('steward.instruction.validate')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => current.rules && props.onEdit(current.rules)}
            >
              {t('steward.instruction.edit')}
            </Button>
          </div>
        </div>
      )}
      {current?.status === 'answered' && current.refusal && (
        <div className="flex flex-col gap-2">
          <p className="break-words font-semibold text-danger">
            {t(`steward.instruction.refusals.${current.refusal}`, { name: steward.name })}
          </p>
          <Button type="button" variant="secondary" className="self-start" onClick={props.openForm}>
            {t('steward.instruction.toForm')}
          </Button>
        </div>
      )}
    </section>
  );
}
