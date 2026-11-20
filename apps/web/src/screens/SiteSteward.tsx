import {
  ArrowUp,
  Button,
  Check,
  EmptyState,
  ListChecks,
  Plus,
  Save,
  ScrollText,
  Sheet,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
} from '@oikos/ui';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { stewardCommand, type StewardCommandInputs } from '../api';
import { useHouse } from '../house';
import { useMoney } from '../money';
import { pendingKeys, sendUnderKey } from '../pending-keys';
import type { SiteRecipe, StewardRules } from '../site-rules';
import { blankRule, draftOf, goodsFor, hireIntent, moveUp } from '../stewards';
import { rulesIntent, rulesOf, staleIntents, type RuleDraft, type Steward } from '../stewards';
import type { StewardActivity, StewardInstruction, StewardOperation } from '../stewards';
import type { StewardOrder } from '../stewards';
import { instructionIntent, refusalRestUntil } from '../stewards';
import type { StewardRule } from '@oikos/contracts';
import { SiteStewardInstruction } from './SiteStewardInstruction';
import { useCommandNotice } from './CommandNotice';
import { dateTimeFormat } from '../game-time';

const CONTROL = 'min-h-11 w-full rounded-md border border-border bg-surface px-3';
const KINDS = ['collect', 'sell', 'buy'] as const;

/**
 * Section Intendant d'un site (4.4) : embaucher, donner une consigne (#280) dont la proposition se valide ou se
 * reprend dans le formulaire, donner les règles par formulaire (sans IA), renvoyer.
 */
export function SiteSteward(props: {
  siteId: string;
  siteName: string;
  /** Recette du site, si la configuration la connaît : ses extrants se vendent, ses intrants se rachètent. */
  recipe: SiteRecipe | null;
  steward: Steward | undefined;
  /** Dernières opérations de l'intendant et son dernier refus (#279) ; absentes tant qu'elles ne sont pas lues. */
  activity?: StewardActivity | undefined;
  /** Dernière consigne de l'intendant et sa réponse (#280) ; absente sans consigne ou tant qu'elle n'est pas lue. */
  instruction?: StewardInstruction | undefined;
  /** Ordres ouverts posés par l'intendant (#562) ; absents tant qu'ils ne sont pas lus. */
  orders?: StewardOrder[] | undefined;
  /** Postes du siège, salaire d'un jour, règles au plus et repos d'un refus (`site_rules`, clé `stewards`). */
  rules: StewardRules;
  /** Durée du tick (`site_rules`, clé `clock`) : sans elle, la fin du repos d'une règle refusée n'est pas annoncée. */
  tickMinutes?: number | null | undefined;
  /** Intendants en poste de la maison. */
  posted: number;
  onChanged: () => Promise<unknown>;
}) {
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const money = useMoney();
  const date = dateTimeFormat(i18n.language);
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
  // Embauche, règles et consigne s'ouvrent chacune dans sa feuille. Le formulaire des règles, voie complète du jeu
  // sans IA : la consigne y mène (IA coupée, refus, « Modifier »).
  const [sheet, setSheet] = useState<'hire' | 'rules' | 'instruction' | null>(null);
  const openForm = () => setSheet('rules');
  // La consigne en cours d'écriture : la feuille se referme à l'envoi, le texte reste jusqu'à un envoi réussi.
  const [draftText, setDraftText] = useState('');
  // Ouverte, la feuille des règles porte le foyer sur le formulaire, qu'elle nomme ; une fois, pas à chaque rendu.
  const rulesForm = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (sheet === 'rules') rulesForm.current?.focus();
  }, [sheet]);
  const kinds = KINDS.filter(
    (kind) => kind !== 'buy' || goodsFor(props.recipe, { kind, goodId: '' }).length > 0,
  );
  const goodName = (id: string) => t(`goods.${id}`, { defaultValue: id });
  const checked = rulesOf(rows);
  const labelId = `steward-${siteId}`;
  /** Une opération en une phrase : ce qu'elle a fait, ou ce qui a été refusé et pourquoi. */
  const describe = (operation: Omit<StewardOperation, 'tick' | 'revision'>) => {
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
  // Repos de la règle du dernier refus (#640) : la fiche dit quand l'intendant la retentera.
  const restUntil =
    steward && props.activity
      ? refusalRestUntil(
          steward,
          props.activity.lastRefusal,
          { refusalRestTicks: rules.refusalRestTicks, tickMinutes: props.tickMinutes ?? null },
          new Date(),
        )
      : null;
  const line = (operation: StewardOperation) =>
    t('steward.ops.line', { date: date.format(operation.at), text: describe(operation) });

  async function run<N extends keyof StewardCommandInputs>(
    name: N,
    intent: string,
    input: StewardCommandInputs[N],
    done: (data: Record<string, unknown>) => string,
  ) {
    if (running.current) return null;
    running.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const send = (key: string) => stewardCommand(name, input, house.accessToken, key);
      const result = await sendUnderKey(keys, intent, () => crypto.randomUUID(), input, send);
      if (result.ok) setDraft(null);
      // L'issue paraît une fois l'intendant relu (#869) : ses opérations, ses ordres ou ses règles, qui
      // agrandissent l'encart au-dessus d'elle, ne la déplacent plus après coup.
      try {
        await props.onChanged();
      } finally {
        setNotice(
          result.ok
            ? { kind: 'status', text: done(result.data) }
            : { kind: 'alert', text: t([`errors.${result.error.code}`, 'errors.INTERNAL']) },
        );
      }
      return result.ok ? 'ok' : result.error.code;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (!steward || !('rules' in checked) || busy) return;
    setSheet(null);
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
    // Encart resserré (#869) : le titre et l'embauche sur une ligne, l'explication dessous, en petit.
    <section
      aria-labelledby={labelId}
      className="flex flex-col gap-1.5 rounded-lg border border-border-subtle bg-muted/40 px-3 py-2.5"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {/* Le titre garde sa largeur : faute de place, « Embaucher » passe dessous, jamais le titre lettre à lettre. */}
        <div className="flex flex-1 basis-32 items-center gap-2">
          <Users aria-hidden="true" className="size-4 shrink-0 text-accent" />
          <h4 id={labelId} className="font-semibold">
            {t('steward.title')}
          </h4>
        </div>
        {!steward && rules.limit > 0 && props.posted < rules.limit && (
          <Button
            icon={<UserPlus aria-hidden="true" />}
            className="aria-disabled:opacity-60"
            aria-disabled={busy}
            aria-label={t('steward.hireFor', { site: props.siteName })}
            aria-haspopup="dialog"
            onClick={() => !busy && setSheet('hire')}
          >
            {t('steward.hire')}
          </Button>
        )}
      </div>
      {!steward ? (
        rules.limit === 0 ? (
          <p className="text-sm text-muted-foreground">{t('steward.noPost')}</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {t('steward.pitch', { cost: money(rules.dailyWageOboles) })}
            </p>
            {props.posted >= rules.limit && (
              <p className="text-sm text-muted-foreground">
                {t('steward.postsTaken', { count: rules.limit })}
              </p>
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
                <EmptyState compact illustration="noOrder" title={t('steward.ops.none')} />
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
              {restUntil && (
                <p className="break-words">
                  {t('steward.ops.resting', { name: steward.name, date: date.format(restUntil) })}
                </p>
              )}
            </section>
          )}
          {props.orders !== undefined && (
            <section aria-labelledby={`${labelId}-orders`} className="flex flex-col gap-1 text-sm">
              <h5 id={`${labelId}-orders`} className="font-semibold">
                {t('steward.orders.title')}
              </h5>
              {props.orders.length === 0 ? (
                <EmptyState compact illustration="noOrder" title={t('steward.orders.none')} />
              ) : (
                <>
                  <ul className="flex flex-col gap-1">
                    {props.orders.map((order) => (
                      <li key={order.id} className="break-words">
                        {t(`steward.orders.${order.side}`, {
                          remaining: order.remaining,
                          quantity: order.quantity,
                          good: goodName(order.goodId),
                          price: money(order.price),
                        })}
                      </li>
                    ))}
                  </ul>
                  <p className="text-muted-foreground">
                    {t('steward.orders.note', { name: steward.name })}
                  </p>
                </>
              )}
            </section>
          )}
          <p className="text-sm">
            {t('steward.rulesCount', { count: steward.rules.length, name: steward.name })}
          </p>
          {props.instruction?.revision === steward.revision &&
            props.instruction.status === 'answered' && (
              <p className="text-sm font-semibold">
                {t('steward.instruction.answered', { name: steward.name })}
              </p>
            )}
          <div className="flex flex-wrap gap-2">
            <Button
              icon={<ScrollText aria-hidden="true" />}
              variant="secondary"
              aria-haspopup="dialog"
              aria-label={t('steward.instruction.openFor', { name: steward.name })}
              onClick={() => setSheet('instruction')}
            >
              {t('steward.instruction.open')}
            </Button>
            <Button
              icon={<ListChecks aria-hidden="true" />}
              variant="secondary"
              aria-haspopup="dialog"
              aria-label={t('steward.rulesOpenFor', { name: steward.name })}
              onClick={() => setSheet('rules')}
            >
              {t('steward.rulesOpen')}
            </Button>
          </div>
          <Sheet
            open={sheet === 'instruction'}
            onClose={() => setSheet(null)}
            title={t('steward.instruction.title')}
            description={steward.name}
            closeLabel={t('shell.close')}
          >
            <SiteStewardInstruction
              steward={steward}
              instruction={props.instruction}
              busy={busy}
              describe={describe}
              draft={draftText}
              onDraft={setDraftText}
              onSubmit={async (text) => {
                setSheet(null);
                const input = { stewardId: steward.id, text };
                const code = await run(
                  'steward.submitInstruction',
                  instructionIntent(steward, text),
                  input,
                  () => t('steward.instruction.sent', { name: steward.name }),
                );
                if (code === 'AI_UNAVAILABLE') openForm();
                return code === 'ok';
              }}
              onValidate={(proposed: StewardRule[]) => {
                setSheet(null);
                const input = { stewardId: steward.id, rules: proposed };
                const done = () =>
                  t('steward.saved', { count: proposed.length, name: steward.name });
                void run('steward.setRules', rulesIntent(steward, proposed), input, done);
              }}
              onEdit={(proposed) => {
                edit(proposed.map(draftOf));
                openForm();
              }}
              onRefresh={() => void props.onChanged()}
              openForm={openForm}
            />
          </Sheet>
          <Sheet
            open={sheet === 'rules'}
            onClose={() => setSheet(null)}
            title={t('steward.rulesOf', { name: steward.name })}
            closeLabel={t('shell.close')}
          >
            <form
              ref={rulesForm}
              tabIndex={-1}
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
                          icon={<ArrowUp aria-hidden="true" />}
                          type="button"
                          variant="secondary"
                          aria-label={t('steward.moveUp', { n })}
                          onClick={() => edit(moveUp(rows, index))}
                        >
                          {t('steward.up')}
                        </Button>
                      )}
                      <Button
                        icon={<Trash2 aria-hidden="true" />}
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
                  icon={<Plus aria-hidden="true" />}
                  type="button"
                  variant="secondary"
                  disabled={rows.length >= rules.rulesPerSteward}
                  onClick={() => edit([...rows, blankRule(props.recipe, 'collect')])}
                >
                  {t('steward.add', { max: rules.rulesPerSteward })}
                </Button>
                <Button
                  icon={<Save aria-hidden="true" />}
                  type="submit"
                  className="aria-disabled:opacity-60"
                  aria-disabled={busy || 'invalid' in checked}
                >
                  {t('steward.save')}
                </Button>
              </div>
            </form>
          </Sheet>
          <Button
            icon={<UserMinus aria-hidden="true" />}
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
      <Sheet
        open={sheet === 'hire'}
        onClose={() => setSheet(null)}
        title={t('steward.hire')}
        description={props.siteName}
        closeLabel={t('shell.close')}
        footer={
          <Button
            icon={<Check aria-hidden="true" />}
            onClick={() => {
              setSheet(null);
              void run('steward.hire', hireIntent(siteId), { siteId }, (data) =>
                t('steward.hireDone', { name: String(data['name']) }),
              );
            }}
          >
            {t('steward.hireConfirm', { cost: money(rules.dailyWageOboles) })}
          </Button>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          <p>{t('steward.pitch', { cost: money(rules.dailyWageOboles) })}</p>
          <p className="text-muted-foreground">
            {t('steward.posts', { posted: props.posted, limit: rules.limit })}
          </p>
        </div>
      </Sheet>
    </section>
  );
}
