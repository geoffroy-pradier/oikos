import { Button } from '@oikos/ui';
import { useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { stewardCommand, type StewardCommandInputs } from '../api';
import { useHouse } from '../house';
import { useMoney } from '../money';
import { pendingKeys, sendUnderKey } from '../pending-keys';
import type { SiteRecipe } from '../site-rules';
import { blankRule, draftOf, goodsFor, hireIntent, moveUp } from '../stewards';
import { rulesIntent, rulesOf, staleIntents, type RuleDraft, type Steward } from '../stewards';
import type { StewardActivity, StewardOperation } from '../stewards';
import { useCommandNotice } from './CommandNotice';

const CONTROL = 'min-h-11 w-full rounded-md border border-border bg-surface px-3';
const KINDS = ['collect', 'sell', 'buy'] as const;

/** Section Intendant d'un site (4.4) : embaucher, donner les règles par formulaire (sans IA), renvoyer. */
export function SiteSteward(props: {
  siteId: string;
  siteName: string;
  /** Recette du site, si la configuration la connaît : ses extrants se vendent, ses intrants se rachètent. */
  recipe: SiteRecipe | null;
  steward: Steward | undefined;
  /** Dernières opérations de l'intendant et son dernier refus (#279) ; absentes tant qu'elles ne sont pas lues. */
  activity?: StewardActivity | undefined;
  /** Postes du siège, salaire d'un jour et règles au plus (`site_rules`, clé `stewards`) ; zéro sans eux. */
  rules: { limit: number; dailyWageOboles: number; rulesPerSteward: number };
  /** Intendants en poste de la maison. */
  posted: number;
  onChanged: () => Promise<unknown>;
}) {
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const money = useMoney();
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' });
  const { steward, rules, siteId } = props;
  const scope = `steward.${house.id}`;
  const keys = useMemo(() => pendingKeys(scope, () => window.sessionStorage), [scope]);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const { setNotice, region } = useCommandNotice();
  // Une intention restée sans réponse devient caduque quand la relecture en montre l'effet (`staleIntents`).
  const [shownId, revision = 0] = [steward?.id, steward?.revision];
  useLayoutEffect(() => {
    const shown = shownId === undefined ? undefined : { id: shownId, revision };
    if (!running.current) keys.settleWhere(staleIntents(siteId, shown));
  }, [keys, siteId, shownId, revision]);
  const [draft, setDraft] = useState<{ stewardId: string; rows: RuleDraft[] } | null>(null);
  const rows =
    steward && draft?.stewardId === steward.id ? draft.rows : (steward?.rules ?? []).map(draftOf);
  const edit = (next: RuleDraft[]) => steward && setDraft({ stewardId: steward.id, rows: next });
  const kinds = KINDS.filter(
    (kind) => kind !== 'buy' || goodsFor(props.recipe, { kind, goodId: '' }).length > 0,
  );
  const goodName = (id: string) => t(`goods.${id}`, { defaultValue: id });
  const checked = rulesOf(rows);
  const labelId = `steward-${siteId}`;
  /** Une opération en une phrase : ce qu'elle a fait, ou ce qui a été refusé et pourquoi. */
  const describe = (operation: StewardOperation) => {
    const good = operation.goodId ? goodName(operation.goodId) : '';
    const { summary } = operation;
    if (operation.status === 'rejected')
      return t(`steward.ops.refused.${operation.kind}`, {
        good,
        reason: t([`errors.${operation.code ?? ''}`, 'errors.INTERNAL']),
      });
    if (summary.command === 'site.collect') {
      const outputs = summary.outputs ?? [];
      const goods = outputs
        .map((stack) => `${stack.quantity} ${goodName(stack.goodId)}`)
        .join(', ');
      return t('steward.ops.collected', { count: summary.cycles ?? 0, goods });
    }
    // L'accord de « vendus » ou « reçus » suit les unités échangées, pas celles de l'ordre.
    const exchanged = summary.side === 'sell' ? 'sold' : 'received';
    return t(`steward.ops.${summary.side}`, {
      quantity: summary.quantity,
      good: goodName(summary.goodId),
      price: money(summary.price),
      traded: t(`steward.ops.${exchanged}`, { count: summary.traded ?? 0 }),
    });
  };
  const line = (operation: StewardOperation) =>
    t('steward.ops.line', { date: date.format(operation.at), text: describe(operation) });

  async function run<N extends keyof StewardCommandInputs>(
    name: N,
    intent: string,
    input: StewardCommandInputs[N],
    done: (data: Record<string, unknown>) => string,
  ) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const send = (key: string) => stewardCommand(name, input, house.accessToken, key);
      const result = await sendUnderKey(keys, intent, () => crypto.randomUUID(), input, send);
      if (result.ok) setDraft(null);
      setNotice(
        result.ok
          ? { kind: 'status', text: done(result.data) }
          : { kind: 'alert', text: t([`errors.${result.error.code}`, 'errors.INTERNAL']) },
      );
      await props.onChanged();
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (!steward || !('rules' in checked)) return;
    const input = { stewardId: steward.id, rules: checked.rules };
    const done = () => t('steward.saved', { count: input.rules.length, name: steward.name });
    void run('steward.setRules', rulesIntent(steward, input.rules), input, done);
  }
  const change = (index: number, patch: Partial<RuleDraft>) =>
    edit(rows.map((row, rank) => (rank === index ? { ...row, ...patch } : row)));

  const choice = (
    label: string,
    value: string,
    options: [string, string][],
    pick: (value: string) => void,
  ) => (
    <label className="flex flex-col gap-1 text-sm">
      <span>{label}</span>
      <select className={CONTROL} value={value} onChange={(event) => pick(event.target.value)}>
        {options.map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <section
      aria-labelledby={labelId}
      className="flex flex-col gap-2 rounded-md border border-border p-3"
    >
      <h4 id={labelId} className="font-semibold">
        {t('steward.title')}
      </h4>
      {!steward ? (
        rules.limit === 0 ? (
          <p className="text-sm text-muted-foreground">{t('steward.noPost')}</p>
        ) : (
          <>
            <p className="text-sm">{t('steward.pitch', { cost: money(rules.dailyWageOboles) })}</p>
            {props.posted >= rules.limit ? (
              <p className="text-sm text-muted-foreground">
                {t('steward.postsTaken', { count: rules.limit })}
              </p>
            ) : (
              <Button
                className="self-start aria-disabled:opacity-60"
                aria-disabled={busy}
                aria-label={t('steward.hireFor', { site: props.siteName })}
                onClick={() =>
                  void run('steward.hire', hireIntent(siteId), { siteId }, (data) =>
                    t('steward.hireDone', { name: String(data['name']) }),
                  )
                }
              >
                {t('steward.hire')}
              </Button>
            )}
          </>
        )
      ) : (
        <>
          <p className="text-sm">
            {t(`steward.${steward.state}`, {
              name: steward.name,
              date: steward.since ? date.format(steward.since) : '',
            })}
          </p>
          {props.activity !== undefined && (
            <section aria-labelledby={`${labelId}-ops`} className="flex flex-col gap-1 text-sm">
              <h5 id={`${labelId}-ops`} className="font-semibold">
                {t('steward.ops.title')}
              </h5>
              {props.activity.recent.length === 0 ? (
                <p className="text-muted-foreground">{t('steward.ops.none')}</p>
              ) : (
                <ol className="flex flex-col gap-1">
                  {props.activity.recent.map((operation, index) => (
                    <li key={index} className="break-words">
                      {line(operation)}
                    </li>
                  ))}
                </ol>
              )}
              {props.activity.lastRefusal && (
                <p className="break-words font-semibold text-danger">
                  {t('steward.ops.lastRefusal', { text: line(props.activity.lastRefusal) })}
                </p>
              )}
            </section>
          )}
          <form
            className="flex flex-col gap-3"
            aria-label={t('steward.rulesOf', { name: steward.name })}
            onSubmit={save}
          >
            {rows.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('steward.noRule')}</p>
            )}
            {rows.map((row, index) => {
              const n = index + 1;
              const fields = row.kind === 'collect' ? [] : (['price', 'units'] as const);
              return (
                <fieldset key={index} className="flex flex-col gap-2 border-t border-border pt-2">
                  <legend className="text-sm font-semibold">{t('steward.rule', { n })}</legend>
                  {choice(
                    t('steward.kind'),
                    row.kind,
                    kinds.map((kind) => [kind, t(`steward.kinds.${kind}`)]),
                    (kind) => change(index, blankRule(props.recipe, kind as RuleDraft['kind'])),
                  )}
                  {row.kind !== 'collect' &&
                    choice(
                      t('steward.good'),
                      row.goodId,
                      goodsFor(props.recipe, row).map((good) => [good, goodName(good)]),
                      (goodId) => change(index, { goodId }),
                    )}
                  {fields.map((field) => (
                    <label key={field} className="flex flex-col gap-1 text-sm">
                      <span>{t(`steward.fields.${row.kind}.${field}`)}</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        className={CONTROL}
                        value={row[field]}
                        onChange={(event) => change(index, { [field]: event.target.value })}
                      />
                    </label>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    {index > 0 && (
                      <Button
                        type="button"
                        variant="secondary"
                        aria-label={t('steward.moveUp', { n })}
                        onClick={() => edit(moveUp(rows, index))}
                      >
                        {t('steward.up')}
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="secondary"
                      aria-label={t('steward.remove', { n })}
                      onClick={() => edit(rows.filter((_, rank) => rank !== index))}
                    >
                      {t('steward.delete')}
                    </Button>
                  </div>
                </fieldset>
              );
            })}
            <p role="alert" className="text-sm font-semibold text-danger">
              {'invalid' in checked ? t('steward.invalid', { n: checked.invalid + 1 }) : ''}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={rows.length >= rules.rulesPerSteward}
                onClick={() => edit([...rows, blankRule(props.recipe, 'collect')])}
              >
                {t('steward.add', { max: rules.rulesPerSteward })}
              </Button>
              <Button
                type="submit"
                className="aria-disabled:opacity-60"
                aria-disabled={busy || 'invalid' in checked}
              >
                {t('steward.save')}
              </Button>
            </div>
          </form>
          <Button
            variant="secondary"
            className="self-start aria-disabled:opacity-60"
            aria-disabled={busy}
            onClick={() =>
              void run('steward.dismiss', `dismiss:${steward.id}`, { stewardId: steward.id }, () =>
                t('steward.dismissed', { name: steward.name }),
              )
            }
          >
            {t('steward.dismiss', { name: steward.name })}
          </Button>
        </>
      )}
      {region}
    </section>
  );
}
