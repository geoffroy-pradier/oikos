import {
  ArrowLeft,
  Ban,
  Button,
  Card,
  Check,
  Clock,
  Coins,
  EmptyState,
  Hourglass,
  Landmark,
  ScrollText,
  StatCard,
  TriangleAlert,
  type Icon,
} from '@oikos/ui';
import { Link } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseCityIdentities } from '../city-identity';
import { useRows } from '../data';
import { useGameTime } from '../game-time';
import { useHouse } from '../house';
import {
  liturgyHonor,
  liturgyState,
  parseLiturgyRules,
  parseMyLiturgies,
  type LiturgyState,
} from '../liturgies';
import { useMoney } from '../money';
import { ScreenHeader } from '../ScreenHeader';
import { LoadProblem, Loading } from './LoadProblem';
import { LiturgySheet } from './LiturgySheet';
import { GENRE_ICONS } from './liturgy-genre';
import { SectionTitle } from './SectionTitle';
import { noticeClass } from './CommandNotice';

/** Teinte et icône d'état : jamais la couleur seule, le texte dit l'état. */
const STATE: Record<LiturgyState, { tone: 'warning' | 'danger' | 'success'; icon: Icon }> = {
  assigned: { tone: 'warning', icon: Hourglass },
  overdue: { tone: 'danger', icon: TriangleAlert },
  performed: { tone: 'success', icon: Check },
  levied: { tone: 'danger', icon: Ban },
};

/**
 * Liturgie de la maison (6.4), ouverte depuis l'alerte du tableau de bord et l'onglet Cité : son genre, son dû et son
 * échéance, puis l'accomplissement en feuille par étapes. Une liturgie prélevée d'office le dit, avec la Timè perdue
 * lue dans le journal de la Timè. Le dû ne se lit que pour sa propre maison.
 */
export function LiturgyScreen() {
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const money = useMoney();
  const now = useGameTime();
  const title = useRef<HTMLHeadingElement>(null);
  const done = useRef<HTMLParagraphElement>(null);
  const mineRows = useRows<unknown>(
    'my_liturgies',
    'id, city_id, season, genre, due, due_at, status',
    'season',
  );
  const rulesRows = useRows<{ rules: unknown }>('liturgy_rules', 'rules', 'rules');
  const honorRows = useRows<unknown>(
    'my_honor_entries',
    'amount, reason, reference',
    'created_at',
    {
      house_id: house.id,
      reason: ['liturgy_performed', 'liturgy_evaded'],
    },
  );
  const identityRows = useRows<unknown>(
    'city_identity',
    'city_id, terroir, has_port, patron_god_id, starting_recipe_id',
    'city_id',
    { city_id: house.cityId },
  );
  const reads = [mineRows, rulesRows, honorRows, identityRows];
  const mine = mineRows.rows === null ? null : parseMyLiturgies(mineRows.rows);
  const liturgy = mine?.[0] ?? null;
  const rules = rulesRows.rows === null ? null : parseLiturgyRules(rulesRows.rows[0] ?? null);
  const identities = identityRows.rows === null ? null : parseCityIdentities(identityRows.rows);
  const godId = liturgy ? (identities?.get(liturgy.cityId)?.patronGodId ?? null) : null;
  const loading = reads.some((read) => read.rows === null && !read.failed);
  const failed =
    reads.some((read) => read.failed) ||
    (!loading &&
      (mine === null || identities === null || (Boolean(rulesRows.rows?.[0]) && !rules)));
  const reload = () => Promise.all(reads.map((read) => read.reload()));
  const [open, setOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const state = liturgy ? liturgyState(liturgy, now.getTime()) : null;
  // Tant que le journal n'est pas lu, aucune Timè : un « 0 » transitoire serait faux.
  const honor =
    liturgy && honorRows.rows !== null ? liturgyHonor(honorRows.rows, liturgy.id) : null;
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });
  const number = new Intl.NumberFormat(i18n.language);
  const GenreIcon = liturgy ? GENRE_ICONS[liturgy.genre] : null;
  const godName = godId ? t(`gods.${godId}`, { defaultValue: godId }) : null;
  const StateIcon = STATE[state ?? 'assigned'].icon;
  const canPerform = state === 'assigned' && rules !== null;
  // Perte de la dérobade : celle du journal une fois prélevée, celle de la configuration avant.
  const loss = honor !== null && honor < 0 ? -honor : (rules?.evasionHonorLoss ?? null);

  return (
    <div className="flex flex-col gap-4 [overflow-wrap:anywhere]">
      <ScreenHeader
        title={t('liturgy.title')}
        action={
          <Link
            to="/cite"
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border bg-surface-raised px-4 font-medium shadow-sm transition-colors duration-(--motion-fast) hover:bg-muted [&_svg]:size-[1.15em]"
          >
            <ArrowLeft aria-hidden="true" className="text-accent" />
            {t('liturgy.back')}
          </Link>
        }
      />
      <p className="text-muted-foreground">{t('liturgy.intro')}</p>
      {/* Région présente avant son texte : l'accomplissement s'annonce ici, la feuille fermée. */}
      <p ref={done} role="status" tabIndex={-1} className={noticeClass('status')}>
        {announcement}
      </p>
      <Card className="flex flex-col gap-4">
        <SectionTitle ref={title} tabIndex={-1} icon={GenreIcon ? <GenreIcon /> : <ScrollText />}>
          {liturgy ? t(`liturgy.genres.${liturgy.genre}`) : t('liturgy.empty.title')}
        </SectionTitle>
        {loading && <Loading />}
        {failed && <LoadProblem heading={title} onRetry={reload} />}
        {!loading && !failed && !liturgy && (
          <EmptyState compact illustration="noEvent" title={t('liturgy.empty.text')} />
        )}
        {liturgy && state && (
          <>
            <dl className="grid gap-3 sm:grid-cols-3">
              <StatCard
                definition
                label={t('liturgy.due')}
                value={money(liturgy.due)}
                icon={<Coins />}
              />
              <StatCard
                definition
                label={t('liturgy.deadline')}
                value={date.format(liturgy.dueAt)}
                icon={<Clock />}
              />
              <StatCard
                definition
                label={t('liturgy.state.label')}
                value={t(`liturgy.state.${state}`)}
                state={{ tone: STATE[state].tone, icon: <StateIcon /> }}
              />
            </dl>
            <p className="text-sm">
              {state === 'assigned' &&
                t(rules ? 'liturgy.notes.assigned' : 'liturgy.notes.assignedNoRules')}
              {state === 'overdue' &&
                (rules
                  ? t('liturgy.notes.overdue', { loss: number.format(rules.evasionHonorLoss) })
                  : t('liturgy.notes.overdueNoRules'))}
              {state === 'performed' &&
                (honor === null
                  ? t('liturgy.notes.performedNoHonor')
                  : t('liturgy.notes.performed', { honor: number.format(Math.max(honor, 0)) }))}
              {state === 'levied' &&
                (loss === null
                  ? t('liturgy.notes.leviedNoLoss')
                  : t('liturgy.notes.levied', { loss: number.format(loss) }))}
            </p>
            {canPerform && (
              <Button
                className="self-start"
                icon={<Landmark aria-hidden="true" />}
                aria-haspopup="dialog"
                onClick={() => setOpen(true)}
              >
                {t('liturgy.perform')}
              </Button>
            )}
            {canPerform && rules && (
              <LiturgySheet
                liturgy={liturgy}
                rules={rules}
                godName={godName}
                open={open}
                onClose={() => setOpen(false)}
                onPerformed={async (message) => {
                  setAnnouncement(message);
                  await reload();
                  done.current?.focus();
                }}
                onRefused={reload}
              />
            )}
          </>
        )}
      </Card>
    </div>
  );
}
