import {
  Amphora,
  Bird,
  Button,
  Card,
  EmptyState,
  GodEmblem,
  ScrollText,
  Sparkles,
  TrendingDown,
} from '@oikos/ui';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionTitle } from './SectionTitle';
import { Help } from './Help';
import { useRows, useTempleRules } from '../data';
import { useHouse } from '../house';
import { ScreenHeader } from '../ScreenHeader';
import { acceptsOfferings, charisByGod, parseCityCharis, parseFavor } from '../temple';
import { LoadProblem, Loading } from './LoadProblem';
import { TempleGraces } from './TempleGraces';
import { TempleOffering } from './TempleOffering';
import { TemplePythia } from './TemplePythia';

/**
 * Écran du temple (10, écran clé 7 ; 7.1 et 7.3), ouvert depuis l'onglet Cité : une carte par dieu de la
 * configuration, avec son emblème, la Charis de la maison envers lui et ce qu'elle perdra à la prochaine clôture,
 * puis la Charis de la cité envers son dieu protecteur. Les calculs sont ceux de `packages/sim`, jamais refaits ici.
 */
export function TempleScreen() {
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const title = useRef<HTMLHeadingElement>(null);
  const rules = useTempleRules();
  const favorRows = useRows<unknown>('my_favor', 'house_id, god_id, charis', 'god_id', {
    house_id: house.id,
  });
  const cityRows = useRows<unknown>('city_charis', 'city_id, god_id, charis', 'city_id', {
    city_id: house.cityId,
  });
  const favor = favorRows.rows === null ? null : parseFavor(favorRows.rows, house.id);
  const city = cityRows.rows === null ? null : parseCityCharis(cityRows.rows, house.cityId);
  const reads = [favorRows, cityRows];
  const loading =
    (rules.rules === null && !rules.failed) ||
    reads.some((read) => read.rows === null && !read.failed);
  const failed =
    rules.failed ||
    reads.some((read) => read.failed) ||
    (favorRows.rows !== null && favor === null) ||
    (cityRows.rows !== null && city === null);
  const reload = () => Promise.all([rules.reload(), ...reads.map((read) => read.reload())]);
  const number = new Intl.NumberFormat(i18n.language);
  const percent = new Intl.NumberFormat(i18n.language, {
    style: 'percent',
    maximumFractionDigits: 2,
  });
  const godName = (id: string) => t(`gods.${id}`, { defaultValue: id });
  const gods = rules.rules && favor ? charisByGod(rules.rules, favor) : null;
  const status = house.citizenshipStatus === 'citizen' ? 'citizen' : 'metic';
  // Taux de déclin commun aux dieux dont la Charis décline : dit une fois, sous le titre (#869) ; des taux
  // différents restent dits dieu par dieu.
  const rates = new Set(
    (gods ?? []).map(({ god }) => god.dailyDecayBps).filter((rate) => rate > 0),
  );
  const sharedRate = rates.size === 1 ? ([...rates][0] ?? null) : null;
  // Dieu dont la feuille d'offrande est ouverte ; `null` : fermée.
  const [offerTo, setOfferTo] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4 [overflow-wrap:anywhere]">
      <ScreenHeader title={t('temple.title', { city: house.cityName })}>
        <Help>{t('temple.intro')}</Help>
      </ScreenHeader>
      <Card className="flex flex-col gap-4">
        <SectionTitle ref={title} tabIndex={-1} icon={<Sparkles />}>
          {t('temple.charis.title')}
        </SectionTitle>
        {sharedRate !== null && (
          <p className="text-sm text-muted-foreground">
            {t('temple.charis.decayRule', { percent: percent.format(sharedRate / 10_000) })}
          </p>
        )}
        {loading && <Loading />}
        {failed && <LoadProblem heading={title} onRetry={reload} />}
        {gods?.length === 0 && (
          <EmptyState compact illustration="noEvent" title={t('temple.charis.none')} />
        )}
        {gods && gods.length > 0 && (
          // Fiches sur ordinateur, liste séparée de filets sur téléphone : pas de carte dans la carte.
          <ul className="grid divide-y divide-border-subtle sm:grid-cols-2 sm:gap-3 sm:divide-y-0 xl:grid-cols-3">
            {gods.map(({ god, charis, decay }) => (
              <li
                key={god.id}
                className="flex items-start gap-3 py-3 first:pt-0 last:pb-0 sm:rounded-xl sm:border sm:border-border-subtle sm:bg-surface-raised sm:p-4 sm:first:pt-4 sm:last:pb-4"
              >
                <GodEmblem godId={god.id} size={48} className="size-12 shrink-0 text-accent" />
                <div className="flex min-w-0 flex-col gap-1">
                  <h3 className="text-base font-semibold tabular-nums">
                    {t('temple.charis.god', {
                      god: godName(god.id),
                      charis: number.format(charis),
                    })}
                  </h3>
                  {/* Taux commun : seul un déclin qui retire quelque chose se dit, sous le dieu (#869). */}
                  {!(sharedRate !== null && god.dailyDecayBps > 0 && decay === 0) && (
                    <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
                      <TrendingDown aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                      <span>
                        {god.dailyDecayBps === 0
                          ? t('temple.charis.noDecay')
                          : sharedRate !== null
                            ? t('temple.charis.lossToday', { loss: number.format(decay) })
                            : t(decay === 0 ? 'temple.charis.noLoss' : 'temple.charis.decay', {
                                loss: number.format(decay),
                                percent: percent.format(god.dailyDecayBps / 10_000),
                              })}
                      </span>
                    </p>
                  )}
                  {acceptsOfferings(god) && (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-2 self-start"
                      icon={<Amphora aria-hidden="true" />}
                      aria-haspopup="dialog"
                      aria-label={t('temple.offering.openFor', { god: godName(god.id) })}
                      onClick={() => setOfferTo(god.id)}
                    >
                      {t('temple.offering.title')}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {rules.rules && (
          <TempleOffering
            rules={rules.rules}
            favor={favor}
            onDone={reload}
            godId={offerTo}
            onClose={() => setOfferTo(null)}
          />
        )}
        {city !== null && cityRows.rows !== null && (
          <div className="flex items-start gap-3 rounded-xl bg-muted p-4">
            {city && <GodEmblem godId={city.godId} size={40} className="size-10 shrink-0" />}
            <div className="flex min-w-0 flex-col gap-1">
              <h3 className="eyebrow">{t('temple.city.title')}</h3>
              <p className="font-medium tabular-nums">
                {city
                  ? t('temple.city.charis', {
                      city: house.cityName,
                      god: godName(city.godId),
                      charis: number.format(city.charis),
                    })
                  : t('temple.city.noPatron', { city: house.cityName })}
              </p>
              {city && (
                <p className="text-sm text-muted-foreground">{t(`temple.city.${status}`)}</p>
              )}
            </div>
          </div>
        )}
      </Card>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-3">
          {rules.rules && favor ? (
            <TempleGraces rules={rules.rules} favor={favor} onDone={reload} />
          ) : (
            <SectionTitle icon={<Bird />}>{t('temple.graces.title')}</SectionTitle>
          )}
        </Card>
        <Card className="flex flex-col gap-3">
          {rules.rules ? (
            <TemplePythia rules={rules.rules} favor={favor} onDone={reload} />
          ) : (
            <SectionTitle icon={<ScrollText />}>{t('temple.pythia.title')}</SectionTitle>
          )}
        </Card>
      </div>
    </div>
  );
}
