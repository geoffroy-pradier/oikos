import { Amphora, Card, Landmark, Sparkles } from '@oikos/ui';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useRows, useTempleRules } from '../data';
import { useHouse } from '../house';
import { charisByGod, parseCityCharis, parseFavor } from '../temple';
import { LoadProblem, Loading } from './LoadProblem';
import { TempleGraces } from './TempleGraces';
import { TempleOffering } from './TempleOffering';
import { TemplePythia } from './TemplePythia';

/**
 * Écran du temple (10, écran clé 7 ; 7.1 et 7.3), ouvert depuis l'onglet Cité : la Charis de la maison envers
 * chaque dieu de la configuration, avec ce qu'elle perdra à la prochaine clôture, et la Charis de la cité envers
 * son dieu protecteur. Les calculs sont ceux de `packages/sim`, jamais refaits ici.
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

  return (
    <div className="flex flex-col gap-4">
      <Card elevation="raised" className="overflow-hidden p-0">
        <div className="flex flex-col gap-1 p-4">
          {/* Icône dans le fil du texte, pas en flex : à police très agrandie, le titre se replie sans déborder. */}
          <h1 className="text-2xl">
            <Landmark
              aria-hidden="true"
              className="mr-2 inline size-6 align-[-0.15em] text-accent"
            />
            {t('temple.title', { city: house.cityName })}
          </h1>
          <p className="text-muted-foreground">{t('temple.intro')}</p>
        </div>
      </Card>
      <Card className="flex flex-col gap-3">
        <h2 ref={title} tabIndex={-1} className="text-xl">
          <Sparkles aria-hidden="true" className="mr-2 inline size-5 align-[-0.15em] text-accent" />
          {t('temple.charis.title')}
        </h2>
        {loading && <Loading />}
        {failed && <LoadProblem heading={title} onRetry={reload} />}
        {gods?.length === 0 && <p className="text-muted-foreground">{t('temple.charis.none')}</p>}
        {gods && gods.length > 0 && (
          <ul className="flex flex-col gap-2">
            {gods.map(({ god, charis, decay }) => (
              <li key={god.id} className="flex flex-col rounded-lg bg-muted/50 p-3">
                <h3 className="font-semibold">
                  {t('temple.charis.god', { god: godName(god.id), charis: number.format(charis) })}
                </h3>
                <p className="text-muted-foreground">
                  {god.dailyDecayBps === 0
                    ? t('temple.charis.noDecay')
                    : t(decay === 0 ? 'temple.charis.noLoss' : 'temple.charis.decay', {
                        loss: number.format(decay),
                        percent: percent.format(god.dailyDecayBps / 10_000),
                      })}
                </p>
              </li>
            ))}
          </ul>
        )}
        {city !== null && cityRows.rows !== null && (
          <>
            <h3 className="eyebrow mt-2">{t('temple.city.title')}</h3>
            <p>
              {city
                ? t('temple.city.charis', {
                    city: house.cityName,
                    god: godName(city.godId),
                    charis: number.format(city.charis),
                  })
                : t('temple.city.noPatron', { city: house.cityName })}
            </p>
            {city && <p className="text-muted-foreground">{t(`temple.city.${status}`)}</p>}
          </>
        )}
      </Card>
      <Card className="flex flex-col gap-3">
        <h2 className="text-xl">
          <Amphora aria-hidden="true" className="mr-2 inline size-5 align-[-0.15em] text-accent" />
          {t('temple.offering.title')}
        </h2>
        {rules.rules && <TempleOffering rules={rules.rules} favor={favor} onDone={reload} />}
      </Card>
      <Card className="flex flex-col gap-3">
        {rules.rules && favor ? (
          <TempleGraces rules={rules.rules} favor={favor} onDone={reload} />
        ) : (
          <h2 className="text-xl">{t('temple.graces.title')}</h2>
        )}
      </Card>
      <Card className="flex flex-col gap-3">
        {rules.rules ? (
          <TemplePythia rules={rules.rules} favor={favor} onDone={reload} />
        ) : (
          <h2 className="text-xl">{t('temple.pythia.title')}</h2>
        )}
      </Card>
    </div>
  );
}
