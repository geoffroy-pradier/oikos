import {
  Button,
  Check,
  CircleAlert,
  DataTable,
  Sheet,
  StatusRegion,
  type DataTableProps,
} from '@oikos/ui';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { PropertyCommandInputs } from '../api';

/** Issue d'une commande confirmée dans une feuille : aboutie, elle la ferme ; refusée, elle y est dite. */
export interface SheetOutcome {
  close: () => void;
  refuse: (text: string | null) => void;
}
/** Lance une commande ; `sheet` : la feuille qui l'a confirmée. */
export type RunCommand = <N extends keyof PropertyCommandInputs>(
  intent: string,
  name: N,
  input: PropertyCommandInputs[N],
  sheet?: SheetOutcome,
) => Promise<void>;

/** Feuille ouverte sur `item`, et le refus de sa dernière commande, effacé à chaque ouverture. */
export function useSheet<T>() {
  const [opened, setOpened] = useState<T | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const open = (item: T | null) => {
    setRefusal(null);
    setOpened(item);
  };
  return { opened, open, refusal, outcome: { close: () => open(null), refuse: setRefusal } };
}

/**
 * Région d'alerte d'une feuille, présente avant le refus qu'elle annonce ; si le bouton qui a lancé la
 * commande a perdu le foyer (inactif le temps de la commande), le foyer va au refus.
 */
export function SheetAlert({ refusal }: { refusal: string | null }) {
  const region = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const active = document.activeElement;
    if (refusal && (active === document.body || active?.matches(':disabled') === true))
      region.current?.focus();
  }, [refusal]);
  return (
    <StatusRegion ref={region} role="alert" tone="danger" className="w-full">
      {refusal}
    </StatusRegion>
  );
}

/**
 * Feuille de confirmation d'une commande de l'immobilier (ADR 0011) : ce que la commande engage, au prix
 * lu à l'ouverture, un avertissement éventuel, qui décrit le bouton de confirmation, puis ce bouton. Une
 * commande en vol garde la feuille ouverte (ni Fermer, ni Échap). `children` remplace le récapitulatif
 * et le bouton : une commande à saisir passe par un `Stepper`.
 */
export function PropertySheet(props: {
  open: boolean;
  onClose: () => void;
  busy: boolean;
  title: string;
  facts?: readonly (readonly [string, string])[];
  warning?: string | null;
  note?: string;
  confirm?: string;
  onConfirm?: () => void;
  /** Refus de la dernière commande, dit près du bouton ; la feuille reste ouverte. */
  refusal?: string | null;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const warningId = useId();
  const { busy, facts = [], warning, confirm, onConfirm } = props;
  return (
    <Sheet
      open={props.open}
      onClose={() => !busy && props.onClose()}
      title={props.title}
      closeLabel={t('shell.close')}
      closeDisabled={busy}
      footer={
        confirm &&
        onConfirm && (
          <>
            <SheetAlert refusal={props.refusal ?? null} />
            <Button
              icon={<Check aria-hidden="true" />}
              loading={busy}
              aria-describedby={warning ? warningId : undefined}
              onClick={onConfirm}
              className="w-full sm:w-auto"
            >
              {confirm}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-3">
        {facts.length > 0 && (
          <dl className="grid grid-cols-2 gap-2.5">
            {facts.map(([label, value]) => (
              <div key={label} className="rounded-xl bg-surface-raised p-3">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 font-bold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        )}
        {warning && (
          <p
            id={warningId}
            className="flex items-start gap-2 rounded-lg bg-danger-subtle p-3 text-sm font-medium text-danger"
          >
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {warning}
          </p>
        )}
        {props.note && <p className="text-sm text-muted-foreground">{props.note}</p>}
        {props.children}
      </div>
    </Sheet>
  );
}

/** Tableau de l'immobilier : `DataTable` à la langue de l'interface, tri annoncé comme aux comptes. */
export function PropertyTable<Row>(
  props: Omit<DataTableProps<Row>, 'sortAnnouncement' | 'locale'>,
) {
  const { t, i18n } = useTranslation();
  return (
    <DataTable
      {...props}
      locale={i18n.language}
      sortAnnouncement={(column, direction) =>
        t(direction === 'ascending' ? 'accounts.sortedAscending' : 'accounts.sortedDescending', {
          column,
        })
      }
    />
  );
}
