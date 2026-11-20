import { Button, EmptyState, ScrollText, Sparkles } from '@oikos/ui';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionTitle } from './SectionTitle';
import { consultOracle } from '../api';
import { useRows } from '../data';
import { useHouse } from '../house';
import { useMoney } from '../money';
import { pendingKeys, sendUnderKey } from '../pending-keys';
import {
  charisIntent,
  charisIntentStale,
  offeringQuote,
  parseOracles,
  type TempleRules,
} from '../temple';
import { useCommandNotice } from './CommandNotice';
import { LoadProblem, Loading } from './LoadProblem';

/** Oracles relus, les plus récemment consultés : un confort de lecture, pas une règle du jeu. */
const SHOWN = 20;

/**
 * La Pythie (7.3) : le prix de la consultation et la Charis qu'elle rapporte au dieu de la Pythie, la
 * consultation au prix vu, et les oracles que la maison a consultés (`my_oracles`). Un oracle ne dit ni le jour ni
 * la cité de son événement : sa date est annoncée imprécise. Son texte, peut-être réécrit par l'IA, s'affiche en
 * texte brut, jamais interprété comme du balisage.
 */
export function TemplePythia(props: {
  rules: TempleRules;
  /** Charis de la maison par dieu, que la consultation fait monter ; `null` tant qu'elle n'est pas lue. */
  favor: ReadonlyMap<string, number> | null;
  onDone: () => Promise<unknown>;
}) {
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const money = useMoney();
  const title = useRef<HTMLHeadingElement>(null);
  const read = useRows<unknown>(
    'my_oracles',
    'id, house_id, text_fr, text_en, source, consulted_at',
    'consulted_at',
    { house_id: house.id },
    { limit: SHOWN },
  );
  const oracles = read.rows === null ? null : parseOracles(read.rows, house.id);
  const keys = useMemo(
    () => pendingKeys(`temple.${house.id}`, () => window.sessionStorage),
    [house.id],
  );
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const { setNotice, region } = useCommandNotice({ styled: true });
  // Une consultation faite sous une autre Charis que celle relue envers le dieu est lue : sa clé est rendue.
  const favorKey = JSON.stringify(props.favor && [...props.favor]);
  useLayoutEffect(() => {
    const favor = JSON.parse(favorKey) as [string, number][] | null;
    if (favor && !running.current) keys.settleWhere(charisIntentStale('oracle', new Map(favor)));
  }, [keys, favorKey]);
  const number = new Intl.NumberFormat(i18n.language);
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });
  const english = i18n.language.startsWith('en');
  const pythia = props.rules.oracle;
  const god = props.rules.gods.find((candidate) => candidate.id === pythia?.godId);
  const price = pythia?.consultationOboles ?? 0;
  const gain = god ? offeringQuote(god, { oboles: price, goods: [] }) : null;
  const godName = t(`gods.${pythia?.godId ?? ''}`, { defaultValue: pythia?.godId ?? '' });

  async function consult() {
    if (running.current || gain === null || !pythia || !props.favor) return;
    running.current = true;
    setBusy(true);
    setNotice(null);
    try {
      // Comptée sur la Charis lue envers le dieu de la Pythie : sans réponse, la consultation repart sous la même
      // clé et au même prix ; un autre prix en vigueur est une demande neuve, sous une clé neuve.
      const intent = charisIntent('oracle', pythia.godId, props.favor.get(pythia.godId) ?? 0);
      const fresh = () => crypto.randomUUID();
      if (keys.entryFor(intent, fresh, price).input !== price) keys.settle(intent);
      const result = await sendUnderKey(keys, intent, fresh, price, (key, sent) =>
        consultOracle(sent ?? price, house.accessToken, key),
      );
      setNotice(
        result.ok
          ? {
              kind: 'status',
              text: t('temple.pythia.done', {
                count: result.data.oracles.length,
                price: money(result.data.oboles),
                gained: number.format(result.data.charisGained),
              }),
            }
          : { kind: 'alert', text: t([`errors.${result.error.code}`, 'errors.INTERNAL']) },
      );
      await Promise.all([read.reload(), props.onDone()]);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <SectionTitle ref={title} tabIndex={-1} icon={<ScrollText />}>
        {t('temple.pythia.title')}
      </SectionTitle>
      <p className="text-sm text-muted-foreground">{t('temple.pythia.intro')}</p>
      {gain === null ? (
        <p className="rounded-xl bg-muted p-4">{t('temple.pythia.unavailable')}</p>
      ) : (
        <div className="flex flex-col gap-3 rounded-xl bg-accent-subtle p-4">
          <p className="font-medium">
            {t('temple.pythia.price', {
              price: money(price),
              god: godName,
              charis: number.format(gain),
            })}
          </p>
          <Button
            className="self-start"
            icon={<Sparkles aria-hidden="true" />}
            disabled={busy || !props.favor}
            loading={busy}
            onClick={() => void consult()}
          >
            {t('temple.pythia.consult', { price: money(price) })}
          </Button>
        </div>
      )}
      {region}
      <h3 className="eyebrow mt-2">{t('temple.pythia.consulted')}</h3>
      {read.rows === null && !read.failed && <Loading />}
      {(read.failed || (read.rows !== null && oracles === null)) && (
        <LoadProblem heading={title} onRetry={() => read.reload()} />
      )}
      {oracles?.length === 0 && (
        <EmptyState compact illustration="noEvent" title={t('temple.pythia.none')} />
      )}
      {oracles && oracles.length > 0 && (
        // Fil des oracles : un trait relie les consultations, la plus récente en haut.
        <ol className="flex flex-col">
          {oracles.map((oracle) => (
            <li
              key={oracle.id}
              className="relative flex flex-col gap-1.5 border-l-2 border-border-subtle pb-5 pl-5 break-words last:border-transparent last:pb-0"
            >
              <span
                aria-hidden="true"
                className="absolute top-1 -left-[7px] size-3 rounded-full border-2 border-surface bg-accent"
              />
              {/* Texte brut : React l'échappe, rien n'y est interprété. */}
              <blockquote className="rounded-xl rounded-tl-sm bg-muted px-4 py-3 whitespace-pre-line break-words italic">
                {english ? oracle.text_en : oracle.text_fr}
              </blockquote>
              <p className="text-sm text-muted-foreground">
                {t('temple.pythia.when', { date: date.format(new Date(oracle.consulted_at)) })}
                {oracle.source === 'ai' ? ` ${t('temple.pythia.aiNote')}` : ''}
              </p>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
