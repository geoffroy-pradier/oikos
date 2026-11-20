import { Button, RefreshCw, Sheet } from '@oikos/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMoney } from '../money';

/**
 * Relance d'un site à l'arrêt (5.5) en feuille : le prix d'un jour, entretien d'une part, salaires et hébergement de
 * l'autre, puis la confirmation au prix vu. Confirmer referme la feuille et lance la commande ; son bouton disparaît
 * avec l'arrêt, et le foyer passe alors à l'issue annoncée sur la fiche.
 */
export function SiteRestart(props: {
  siteName: string;
  /** Prix d'une relance : entretien, salaires et hébergement d'un jour, au salaire du jour de la cité. */
  cost: number;
  upkeep: number;
  busy: boolean;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const money = useMoney();
  const [open, setOpen] = useState(false);
  const line = (label: string, amount: number, total = false) => (
    <div className={`flex flex-wrap justify-between gap-x-4 py-2 ${total ? 'font-semibold' : ''}`}>
      <dt className={total ? '' : 'text-muted-foreground'}>{label}</dt>
      <dd className="tabular-nums">{money(amount)}</dd>
    </div>
  );
  return (
    <>
      <Button
        variant="secondary"
        icon={<RefreshCw aria-hidden="true" />}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
        aria-disabled={props.busy}
        aria-label={t('home.restartSite', { site: props.siteName, cost: money(props.cost) })}
        onClick={() => !props.busy && setOpen(true)}
      >
        {t('home.restart', { cost: money(props.cost) })}
      </Button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={t('sites.restart.title', { site: props.siteName })}
        description={t('sites.restart.description')}
        closeLabel={t('shell.close')}
        footer={
          <Button
            onClick={() => {
              setOpen(false);
              props.onConfirm();
            }}
          >
            {t('sites.restart.confirm', { cost: money(props.cost) })}
          </Button>
        }
      >
        <dl className="divide-y divide-border-subtle text-sm">
          {line(t('sites.restart.upkeep'), props.upkeep)}
          {line(t('sites.restart.wages'), props.cost - props.upkeep)}
          {line(t('sites.restart.total'), props.cost, true)}
        </dl>
      </Sheet>
    </>
  );
}
