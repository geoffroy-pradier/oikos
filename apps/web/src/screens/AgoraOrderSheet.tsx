import { marketPlaceOrderInputSchema, type MarketPlaceOrderInput } from '@oikos/contracts';
import type { MarketTaxRule } from '@oikos/sim';
import { Button, EmptyState, NumberField, Sheet, StatusRegion, Stepper } from '@oikos/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { previewSale } from '../market-rules';
import { formatOboles, useMoney } from '../money';

export type Side = 'sell' | 'buy';
interface Draft {
  side: Side;
  price: number | null;
  quantity: number | null;
}

export interface AgoraOrderSheetProps {
  /** Sens de l'ordre en cours de saisie ; `null` : feuille fermée. */
  side: Side | null;
  onClose: () => void;
  cityId: string;
  cityName: string;
  goodId: string;
  tax: MarketTaxRule | null;
  /**
   * Stock libre du bien dans la cité (vente), lu à l'ouverture de la feuille ; `null` sans cette lecture :
   * ni borne ni refus ici, l'API juge.
   */
  free: number | null;
  /** Trésorerie de la maison (achat), en oboles, lue à l'ouverture de la feuille ; `null` sans elle. */
  cash: number | null;
  /** Meilleur niveau du côté opposé du carnet : le premier achat pour une vente, la première vente pour un achat. */
  best: { price: number; quantity: number } | null;
  /** Dépose l'ordre ; rend le message d'un refus, ou `null` s'il est déposé (l'écran ferme alors la feuille). */
  onPlace: (input: MarketPlaceOrderInput) => Promise<string | null>;
}

/**
 * Feuille d'un ordre à cours limité (ADR 0011) : quantité et prix, puis récapitulatif chiffré et dépôt.
 * Le bien et la cité sont ceux de l'écran. La saisie survit à la fermeture : un ordre resté sans réponse se
 * renvoie tel quel, sous la même clé.
 */
export function AgoraOrderSheet(props: AgoraOrderSheetProps) {
  const { side, cityId, cityName: city, goodId, tax, free, cash, best } = props;
  const { t, i18n } = useTranslation();
  const money = useMoney();
  const number = new Intl.NumberFormat(i18n.language);
  const oboles = (amount: number) => formatOboles(amount, t, i18n.language);
  const [kept, setDraft] = useState<Draft>({ side: 'sell', price: null, quantity: null });
  // Une saisie de l'autre sens ne se reprend pas.
  const draft = side && kept.side !== side ? { side, price: null, quantity: null } : kept;
  const { price, quantity } = draft;
  const [checkError, setCheckError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // À l'ouverture, le foyer va à la quantité, première saisie de la feuille.
  useEffect(() => {
    if (side) document.getElementById('order-quantity')?.focus();
  }, [side]);

  const good = t(`goods.${goodId}`);
  const selling = draft.side === 'sell';
  const input = marketPlaceOrderInputSchema.safeParse({
    cityId,
    goodId,
    side: draft.side,
    price,
    quantity,
  });
  const preview = previewSale(tax, draft.side, String(price ?? ''), String(quantity ?? ''));
  // Borne des raccourcis : le stock libre d'une vente, ce que la trésorerie paie d'un achat à ce prix.
  const affordable = cash !== null && price !== null && price >= 1 ? Math.floor(cash / price) : 0;
  const bound = selling ? (free ?? 0) : affordable;
  const update = (change: Partial<Draft>) => {
    setDraft({ ...draft, ...change });
    setCheckError(null);
  };

  const check = () => {
    const problem = !input.success
      ? t('errors.VALIDATION_FAILED')
      : selling && free !== null && input.data.quantity > free
        ? t('agora.overStock', { free: number.format(free), good, city })
        : null;
    setCheckError(problem);
    setFailure(null);
    return problem === null;
  };

  async function confirm() {
    if (!input.success || busy) return;
    setBusy(true);
    setFailure(null);
    const refusal = await props.onPlace(input.data);
    setBusy(false);
    if (refusal === null) setDraft({ side: draft.side, price: null, quantity: null });
    else setFailure(refusal);
  }

  const close = () => {
    // Commande en vol : la feuille reste ouverte, pour que son issue y soit dite.
    if (busy) return;
    // Une saisie illisible ne se garde pas : le champ rouvert serait vide de toute façon.
    const valid = (value: number | null) => (value !== null && Number.isNaN(value) ? null : value);
    setDraft({ side: draft.side, price: valid(price), quantity: valid(quantity) });
    setCheckError(null);
    setFailure(null);
    props.onClose();
  };

  // Communs aux deux saisies : la langue, au moins une unité ou une obole, le net qu'elles décrivent.
  const field = {
    locale: i18n.language,
    min: 1,
    labels: {
      decrement: t('controls.decrement'),
      increment: t('controls.increment'),
      all: t('controls.all'),
      shortcuts: t('controls.shortcuts'),
    },
    messages: {
      unreadable: t('controls.unreadable'),
      ambiguous: t('controls.ambiguous'),
      notInteger: t('controls.notInteger'),
      belowMin: t('controls.belowMin', { min: number.format(1) }),
      // Au-delà du stock libre, la vente est refusée ; un achat, lui, s'exécute pour ce qu'il paie.
      ...(selling ? { aboveMax: t('controls.aboveMax', { max: number.format(bound) }) } : {}),
    },
    'aria-describedby': selling ? 'expected-net' : undefined,
  };
  const known = selling
    ? free !== null && t('agora.freeStock', { quantity: number.format(free), good, city })
    : cash !== null && t('agora.cash', { amount: money(cash) });

  const amountStep = (
    <div className="flex flex-col gap-4">
      {known && <p className="text-sm text-muted-foreground">{known}</p>}
      <NumberField
        {...field}
        id="order-quantity"
        label={t('agora.quantity')}
        value={quantity}
        onValueChange={(value) => update({ quantity: value })}
        {...(bound >= 1 ? { max: bound } : {})}
      />
      <NumberField
        {...field}
        id="order-price"
        label={t('agora.limitPrice')}
        value={price}
        onValueChange={(value) => update({ price: value })}
        shortcuts={false}
      />
      {best ? (
        <div className="-mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-muted p-3 text-sm">
          <p className="min-w-0 flex-1 basis-48">
            {t(selling ? 'agora.bestBid' : 'agora.bestAsk', {
              quantity: number.format(best.quantity),
              good,
              price: oboles(best.price),
            })}
          </p>
          <Button
            variant="secondary"
            size="sm"
            disabled={price === best.price}
            onClick={() => update({ price: best.price })}
          >
            {t('agora.useBest', { price: oboles(best.price) })}
          </Button>
        </div>
      ) : (
        <EmptyState
          compact
          illustration="noOrder"
          title={t(selling ? 'agora.bidsEmpty' : 'agora.bookEmpty')}
        />
      )}
      {/* Description des deux champs et du dépôt : lue en y arrivant, pas annoncée à chaque frappe. */}
      <p id="expected-net" className="rounded-lg bg-info-subtle p-3 text-sm empty:hidden">
        {preview &&
          t('agora.expectedNet', {
            net: money(preview.net),
            gross: money(preview.gross),
            tax: money(preview.tax),
          })}
      </p>
      <StatusRegion role="alert" tone="danger">
        {checkError}
      </StatusRegion>
    </div>
  );

  // Récapitulatif : brut, taxe et net d'une vente (sans taxe connue et non nulle, le brut seul) ;
  // coût au plus et séquestre d'un achat.
  const gross = input.success ? input.data.price * input.data.quantity : 0;
  const lines: (readonly [string, string, boolean?])[] = selling
    ? [
        [t('agora.gross'), money(gross)],
        ...(preview
          ? [
              [t('agora.tax'), money(preview.tax)] as const,
              [t('agora.net'), money(preview.net), true] as const,
            ]
          : []),
      ]
    : [
        [t('agora.cost'), money(gross)],
        [t('agora.escrow'), t('agora.escrowUpTo', { amount: money(gross) })],
      ];
  const recapStep = input.success && (
    <div className="flex flex-col gap-3">
      <p className="font-medium">
        {t(selling ? 'agora.recapSell' : 'agora.recapBuy', {
          quantity: number.format(input.data.quantity),
          good,
          price: oboles(input.data.price),
        })}
      </p>
      <dl className="divide-y divide-border-subtle rounded-lg border border-border-subtle px-3 tabular-nums">
        {lines.map(([term, value, strong]) => (
          <div key={term} className="flex flex-wrap justify-between gap-x-4 py-2">
            <dt className={strong ? 'font-semibold' : 'text-muted-foreground'}>{term}</dt>
            <dd className={strong ? 'font-semibold' : undefined}>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-muted-foreground">
        {t(selling ? 'agora.recapSellNote' : 'agora.recapBuyNote')}
      </p>
      <StatusRegion role="alert" tone="danger">
        {failure}
      </StatusRegion>
    </div>
  );

  return (
    <Sheet
      open={side !== null}
      onClose={close}
      title={t(selling ? 'agora.sellTitle' : 'agora.buyTitle', { good })}
      description={t('agora.title', { city })}
      closeLabel={t('shell.close')}
    >
      <Stepper
        confirming={busy}
        confirmDescribedBy={selling ? 'expected-net' : undefined}
        onConfirm={() => void confirm()}
        labels={{
          progress: t('stepper.progress'),
          back: t('stepper.back'),
          next: t('stepper.next'),
          confirm: t('agora.submit'),
          stepOf: (current, total) =>
            t('stepper.stepOf', { current: number.format(current), total: number.format(total) }),
        }}
        steps={[
          { id: 'amount', title: t('agora.stepAmount'), content: amountStep, check },
          { id: 'recap', title: t('agora.stepRecap'), content: recapStep },
        ]}
      />
    </Sheet>
  );
}
