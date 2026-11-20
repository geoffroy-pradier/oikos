import { Button, Card, ChevronRight, cn, EmptyState, GoodIcon, Wheat } from '@oikos/ui';
import { Link } from '@tanstack/react-router';
import { useId, type ReactNode, type Ref } from 'react';
import { useTranslation } from 'react-i18next';

/** Un site tel que le tableau de bord le montre, calculé par `SitesCard`. */
export interface ProductionItem {
  id: string;
  name: string;
  city: string;
  /** Premier extrant de sa production, pour son pictogramme ; `null` si la production est retirée. */
  goodId: string | null;
  /** Avancement du cycle en cours (0 à 1) et sa légende ; `null` tant que l'heure ou les règles manquent. */
  progress: { done: number; text: string; tone: 'primary' | 'success' | 'danger' } | null;
  /**
   * Ce qu'une récolte donnerait maintenant (« 80 × Blé ») ; `null` : rien ; `undefined` : pas encore estimé (heure,
   * stock ou événements non lus), dit « — » plutôt que « rien ».
   */
  ready?: string | null | undefined;
  /** Production retirée de la configuration : ni récolte ni relance. */
  retired: boolean;
}

const BAR = { primary: 'bg-primary', success: 'bg-success', danger: 'bg-danger' } as const;
// Pendant une commande, les boutons restent atteignables (le foyer ne retombe pas sur la page).
const WAITING = 'aria-disabled:cursor-not-allowed aria-disabled:opacity-60';
const COLUMNS = 'lg:grid-cols-[minmax(0,1.5fr)_minmax(0,0.8fr)_minmax(0,1.6fr)_minmax(0,1fr)_auto]';

/**
 * Production en cours du tableau de bord : un site par ligne (site, cité, prochaine récolte, prêt, actions),
 * en tableau à partir de 1 024 px et en fiches en dessous. « Récolter », action principale d'un site, est
 * inactif quand le calcul affiché ne prévoit rien, sa raison (« Rien de prêt ») à côté ; non estimé, il
 * reste actif et l'API juge. Le résultat s'annonce sous la ligne (`announce`).
 */
export function ProductionList(props: {
  items: ProductionItem[] | null;
  /** Sites qui ont quelque chose à récolter, d'après le calcul affiché. */
  harvestable: number;
  busy: boolean;
  onCollect: (id: string) => void;
  onCollectAll: () => void;
  announce: (target: string) => ReactNode;
  /** Chargement, lecture en échec : ce que la carte montre avant ses lignes. */
  status: ReactNode;
  titleRef: Ref<HTMLHeadingElement>;
  /** Avertissement d'une acquisition restée sans réponse, à vérifier sur l'écran Sites. */
  warning?: string | null;
}) {
  const { t, i18n } = useTranslation();
  const number = new Intl.NumberFormat(i18n.language);
  const { items, harvestable } = props;
  const ids = useId();
  return (
    <Card className="flex flex-col gap-3 p-0 pb-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
        <h2 ref={props.titleRef} tabIndex={-1} className="text-base font-semibold">
          {t('production.title')}
        </h2>
        {harvestable > 0 && (
          <Button
            icon={<Wheat aria-hidden="true" />}
            className={WAITING}
            aria-disabled={props.busy}
            aria-label={t('home.collectAllLabel', {
              count: harvestable,
              number: number.format(harvestable),
            })}
            onClick={props.onCollectAll}
          >
            {t('home.collectAll')}
          </Button>
        )}
      </div>
      {props.warning && (
        <div className="mx-4 flex flex-col gap-1 rounded-lg bg-warning-subtle p-3 text-sm">
          <p className="font-semibold text-warning">{props.warning}</p>
          <Link
            to="/sites"
            className="self-start font-semibold text-warning underline underline-offset-4"
          >
            {t('production.checkSites')}
          </Link>
        </div>
      )}
      <div className="px-4 empty:hidden">{props.announce('all')}</div>
      <div className="px-4 empty:hidden">{props.status}</div>
      {items?.length === 0 && (
        <EmptyState
          className="mx-4 mb-2"
          illustration="noSite"
          title={t('home.sitesEmpty')}
          action={
            <Link to="/sites" className="font-semibold text-primary underline underline-offset-4">
              {t('home.acquire')}
            </Link>
          }
        />
      )}
      {items && items.length > 0 && (
        <>
          <div
            aria-hidden="true"
            className={cn('hidden gap-4 px-4 pb-1 text-xs text-muted-foreground lg:grid', COLUMNS)}
          >
            <span>{t('production.site')}</span>
            <span>{t('production.city')}</span>
            <span>{t('production.next')}</span>
            <span className="text-right">{t('production.ready')}</span>
            <span className="w-52" />
          </div>
          <ul className="flex flex-col gap-2 px-2 lg:gap-0 lg:px-0">
            {items.map((item) => (
              <li
                key={item.id}
                className="rounded-xl border border-border-subtle p-3 lg:rounded-none lg:border-x-0 lg:border-b-0 lg:px-4"
              >
                <div
                  className={cn(
                    'grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 lg:gap-4',
                    COLUMNS,
                  )}
                >
                  <div className="col-span-2 flex min-w-0 items-center gap-3 lg:col-span-1">
                    <span
                      aria-hidden="true"
                      className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-subtle text-primary"
                    >
                      {item.goodId && <GoodIcon goodId={item.goodId} />}
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-semibold">{item.name}</h3>
                      <p className="text-sm text-muted-foreground lg:hidden">{item.city}</p>
                    </div>
                  </div>
                  <p className="hidden text-sm text-foreground-secondary lg:block">{item.city}</p>
                  <div className="col-span-2 flex flex-col gap-1.5 lg:col-span-1">
                    {item.progress && (
                      <>
                        <div
                          role="progressbar"
                          aria-label={t('production.nextOf', { site: item.name })}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.round(item.progress.done * 100)}
                          aria-valuetext={item.progress.text}
                          className="h-1.5 overflow-hidden rounded-full bg-muted"
                        >
                          <div
                            className={cn(
                              'h-full rounded-full transition-[width] duration-(--motion-base)',
                              BAR[item.progress.tone],
                            )}
                            style={{ width: `${item.progress.done * 100}%` }}
                          />
                        </div>
                        <p
                          aria-hidden="true"
                          className={cn(
                            'text-xs tabular-nums',
                            item.progress.tone === 'danger'
                              ? 'text-danger'
                              : 'text-muted-foreground',
                          )}
                        >
                          {item.progress.text}
                        </p>
                      </>
                    )}
                    {item.retired && (
                      <p className="text-sm font-semibold text-danger">{t('production.retired')}</p>
                    )}
                  </div>
                  <p className="text-sm tabular-nums lg:text-right">
                    {item.ready ? (
                      <span className="font-semibold text-success">
                        {t('production.readyLine', { list: item.ready })}
                      </span>
                    ) : item.ready === null ? (
                      <span id={`${ids}-${item.id}`} className="text-muted-foreground">
                        {t('production.nothing')}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        <span aria-hidden="true">—</span>
                        <span className="sr-only">{t('production.unknown')}</span>
                      </span>
                    )}
                  </p>
                  <div className="flex flex-wrap items-center justify-end gap-1 lg:w-52">
                    {!item.retired && (
                      <Button
                        icon={<Wheat aria-hidden="true" />}
                        size="sm"
                        inactive={item.ready === null}
                        aria-describedby={item.ready === null ? `${ids}-${item.id}` : undefined}
                        className={item.ready === null ? undefined : WAITING}
                        aria-disabled={props.busy}
                        aria-label={t('home.collectSite', { site: item.name })}
                        onClick={() => props.onCollect(item.id)}
                      >
                        {t('home.collect')}
                      </Button>
                    )}
                    <Link
                      to="/sites"
                      hash={`site-${item.id}`}
                      aria-label={t('production.detailsOf', { site: item.name })}
                      className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-sm font-medium text-foreground-secondary hover:bg-muted hover:text-foreground"
                    >
                      {t('production.details')}
                      <ChevronRight aria-hidden="true" className="size-4" />
                    </Link>
                  </div>
                </div>
                <div className="[&_p]:mt-2">{props.announce(item.id)}</div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
