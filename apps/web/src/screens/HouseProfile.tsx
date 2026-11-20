import {
  ArrowLeft,
  Badge,
  Button,
  Card,
  Check,
  Crown,
  EmptyState,
  Info,
  Landmark,
  ScrollText,
} from '@oikos/ui';
import { useParams, useRouter } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Blazon } from '../Blazon';
import { useHouse } from '../house';
import { useHouseProfile } from '../house-profile';
import { LoadProblem, Loading } from './LoadProblem';
import { NotFound } from './NotFound';

/**
 * Fiche publique d'une maison (6.6) : blason, nom, cité, statut, Timè, mandats passés et en cours. Elle ne lit
 * que des vues publiques (`PROFILE_VIEWS`). Une maison inconnue ou d'un autre monde donne l'écran introuvable.
 */
export function HouseProfileScreen() {
  const { t, i18n } = useTranslation();
  const own = useHouse();
  const router = useRouter();
  const { houseId } = useParams({ strict: false });
  const read = useHouseProfile(houseId);
  const { profile } = read;
  const title = useRef<HTMLHeadingElement>(null);
  const shown = profile !== null && profile !== 'unknown';
  // L'écran s'ouvre depuis un lien : le foyer va au titre de la fiche dès qu'elle est lue.
  const ready = shown && !read.loading && !read.failed;
  useEffect(() => {
    if (ready) title.current?.focus();
  }, [ready]);
  if (profile === 'unknown') return <NotFound />;
  const number = new Intl.NumberFormat(i18n.language);
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' });
  const city = (id: string | null) => (id ? (own.cityNames[id] ?? null) : null);
  const cityName = shown ? city(profile.cityId) : null;
  return (
    <div className="flex flex-col gap-4 [overflow-wrap:anywhere]">
      <Button
        variant="ghost"
        className="self-start"
        icon={<ArrowLeft aria-hidden="true" />}
        onClick={() =>
          window.history.length > 1 ? router.history.back() : void router.navigate({ to: '/' })
        }
      >
        {t('houseProfile.back')}
      </Button>
      {read.loading && <Loading />}
      {read.failed && <LoadProblem onRetry={read.reload} />}
      {shown && ready && (
        <>
          <header className="flex items-center gap-4">
            {profile.blazon && <Blazon blazon={profile.blazon} className="size-16" />}
            <div className="flex min-w-0 flex-col gap-1.5">
              <h1 ref={title} tabIndex={-1} className="text-[1.625rem] leading-tight font-bold">
                {profile.name}
              </h1>
              {profile.status && (
                <Badge
                  tone={profile.status === 'citizen' ? 'success' : 'neutral'}
                  icon={profile.status === 'citizen' ? <Check /> : <Info />}
                  className="self-start"
                >
                  {cityName
                    ? t(`houseProfile.status.${profile.status}`, { city: cityName })
                    : t(`houseProfile.statusOnly.${profile.status}`)}
                </Badge>
              )}
            </div>
          </header>
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            <Card className="flex items-start gap-3">
              <Landmark aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-accent" />
              <dl className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-[0.8125rem] text-muted-foreground">{t('houseProfile.city')}</dt>
                <dd className="font-semibold">{cityName ?? t('houseProfile.noCity')}</dd>
              </dl>
            </Card>
            <Card className="flex items-start gap-3">
              <Crown aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-accent" />
              <dl className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-[0.8125rem] text-muted-foreground">
                  {t('houseProfile.honor')}
                </dt>
                <dd className="text-2xl leading-tight font-bold tabular-nums">
                  {number.format(read.honor ?? 0)}
                </dd>
              </dl>
            </Card>
          </div>
          <Card className="flex flex-col gap-3">
            <h2 className="flex items-center gap-2 text-lg font-semibold [&_svg]:size-5 [&_svg]:text-accent">
              <ScrollText aria-hidden="true" />
              {t('houseProfile.mandates')}
            </h2>
            {read.mandates?.length === 0 && (
              <EmptyState compact illustration="noEvent" title={t('houseProfile.noMandate')} />
            )}
            <ul className="flex flex-col gap-2">
              {read.mandates?.map((mandate) => (
                <li
                  key={`${mandate.cityId}-${mandate.office}-${mandate.startsAt}`}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-border-subtle p-3"
                >
                  <span className="min-w-0">
                    <span className="font-semibold">
                      {t(`houseProfile.offices.${mandate.office}`, {
                        defaultValue: mandate.office,
                      })}
                    </span>{' '}
                    <span className="text-muted-foreground">
                      {t('houseProfile.mandateOf', {
                        city: city(mandate.cityId) ?? t('houseProfile.noCity'),
                        from: date.format(mandate.startsAt),
                        to: date.format(mandate.endsAt),
                      })}
                    </span>
                  </span>
                  <Badge tone={mandate.inOffice ? 'primary' : 'neutral'}>
                    {t(mandate.inOffice ? 'houseProfile.inOffice' : 'houseProfile.past')}
                  </Badge>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
