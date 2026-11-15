/** Accès typé à la base pour l'API de jeu et le moteur (Kysely). */
import type { Blazon } from '@oikos/contracts';
import {
  Kysely,
  PostgresDialect,
  type ColumnType,
  type Generated,
  type GeneratedAlways,
} from 'kysely';
import pg from 'pg';

/** Tables du schéma `game`. À remplacer par les types générés quand le schéma grossira. */
export interface GameDatabase {
  'game.worlds': { id: Generated<string>; slug: string; name: string; created_at: Generated<Date> };
  'game.cities': {
    id: Generated<string>;
    world_id: string;
    slug: string;
    name: string;
    created_at: Generated<Date>;
  };
  'game.houses': {
    id: Generated<string>;
    world_id: string;
    user_id: string;
    name: string;
    /** Colonne générée : `lower(name)`. */
    name_key: GeneratedAlways<string>;
    /** `jsonb` : lu désérialisé, écrit sous forme de texte JSON. */
    blazon: ColumnType<Blazon, string, string>;
    created_at: Generated<Date>;
  };
  'game.citizenships': {
    id: Generated<string>;
    house_id: string;
    city_id: string;
    status: Generated<'metic' | 'citizen'>;
    since: Generated<Date>;
  };

  'game.command_log': {
    id: Generated<string>;
    user_id: string;
    command: string;
    idempotency_key: string | null;
    input: ColumnType<unknown, string, never>;
    status: 'ok' | 'rejected' | 'failed';
    error_code: string | null;
    response: ColumnType<unknown, string, never>;
    duration_ms: number;
    aal?: 'aal1' | 'aal2' | null;
    admin_role?: string | null;
    config_version_id?: string | null;
    created_at: Generated<Date>;
  };
  'game.domain_events': {
    id: Generated<string>;
    seq: GeneratedAlways<string>;
    command_id: string | null;
    type: string;
    payload: ColumnType<unknown, string, never>;
    created_at: Generated<Date>;
  };

  /** Comptes de monnaie : le solde ne change que par `game.ledger_lines` (déclencheur). */
  'game.accounts': {
    id: Generated<string>;
    world_id: string;
    kind: 'house' | 'system' | 'escrow' | 'treasury';
    house_id: string | null;
    system_key: string | null;
    /** Trésor de la cité (`kind = 'treasury'`) : sa cité ; nul pour tout autre compte. */
    city_id: Generated<string | null>;
    allow_negative: Generated<boolean>;
    /** `bigint` : lu en texte. */
    balance: ColumnType<string, never, never>;
    created_at: Generated<Date>;
  };
  'game.ledger_entries': {
    id: Generated<string>;
    world_id: string;
    kind: string;
    meta: ColumnType<unknown, string | undefined, never>;
    created_at: Generated<Date>;
  };
  /** Montant en oboles : positif pour un crédit, négatif pour un débit. */
  'game.ledger_lines': {
    id: Generated<string>;
    entry_id: string;
    account_id: string;
    amount: ColumnType<string, number, never>;
  };
  /** Stocks : la quantité ne change que par `game.stock_ledger`, la réservation que par les ordres. */
  'game.inventories': {
    id: Generated<string>;
    world_id: string;
    house_id: string;
    city_id: string;
    good_id: string;
    quantity: ColumnType<string, never, never>;
    reserved: ColumnType<string, never, never>;
    created_at: Generated<Date>;
  };
  'game.stock_ledger': {
    id: Generated<string>;
    world_id: string;
    good_id: string;
    quantity: ColumnType<string, number, never>;
    from_inventory_id?: string | null;
    from_system?: string | null;
    to_inventory_id?: string | null;
    to_system?: string | null;
    kind: string;
    ledger_entry_id?: string | null;
    created_at: Generated<Date>;
  };
  /** Ordres de l'agora : le reste ne change que par un échange, l'état que par une annulation. */
  'game.orders': {
    id: Generated<string>;
    seq: GeneratedAlways<string>;
    world_id: string;
    city_id: string;
    house_id: string;
    good_id: string;
    side: 'buy' | 'sell';
    price: ColumnType<string, number, never>;
    quantity: ColumnType<string, number, never>;
    remaining: ColumnType<string, number, never>;
    status: ColumnType<'open' | 'filled' | 'cancelled', undefined, 'cancelled'>;
    created_at: Generated<Date>;
  };
  'game.trades': {
    id: Generated<string>;
    world_id: string;
    sell_order_id: string;
    buy_order_id: string | null;
    price: ColumnType<string, number, never>;
    quantity: ColumnType<string, number, never>;
    ledger_entry_id: string;
    /** Écrit par les tests pour dater un échange ; le jeu laisse la base le remplir. */
    created_at: ColumnType<Date, Date | undefined, never>;
    /** Rang d'exécution : départage les échanges d'une même transaction. */
    seq: GeneratedAlways<string>;
  };
  /** Chandeliers de prix : le moteur les insère et n'en recalcule que les valeurs. */
  'game.price_candles': {
    world_id: ColumnType<string, string, never>;
    city_id: ColumnType<string, string, never>;
    good_id: ColumnType<string, string, never>;
    period_seconds: ColumnType<number, number, never>;
    period_start: ColumnType<Date, Date, never>;
    open: ColumnType<string, number, number>;
    high: ColumnType<string, number, number>;
    low: ColumnType<string, number, number>;
    close: ColumnType<string, number, number>;
    volume: ColumnType<string, number, number>;
    turnover: ColumnType<string, number, number>;
  };
  /** Prix de référence observé d'un marché : une ligne, dont le moteur remplace les valeurs. */
  'game.observed_prices': {
    world_id: ColumnType<string, string, never>;
    city_id: ColumnType<string, string, never>;
    good_id: ColumnType<string, string, never>;
    price: ColumnType<string, number, number>;
    volume: ColumnType<string, number, number>;
    window_seconds: number;
    observed_at: Date;
  };
  'game.sites': {
    id: Generated<string>;
    world_id: string;
    house_id: string;
    city_id: string;
    /** Modifiable, à condition de repartir d'un cycle neuf (garde de la base). */
    recipe_id: string;
    cycle_started_at: ColumnType<Date, Date | undefined, Date>;
    /** Instant de l'arrêt d'un site impayé ; nul s'il tourne. Un site naît en marche. */
    halted_at: ColumnType<Date | null, never, Date | null>;
    created_at: Generated<Date>;
  };
  /** Clôtures quotidiennes jouées : une ligne par monde et par jour de jeu, en ajout seul. */
  'game.daily_closes': {
    world_id: string;
    game_day: number;
    close_at: Date;
    config_version_id: string;
    summary: ColumnType<unknown, string | undefined, never>;
    /** Horloge de la base à l'écriture : le service n'a pas le droit de la fournir. */
    finished_at: ColumnType<Date, never, never>;
  };

  /** Fraction de demande des PNJ reportée d'un tick au suivant, par cité et par bien. */
  'game.npc_demand_carry': {
    world_id: string;
    city_id: string;
    good_id: string;
    carry: number;
    updated_at: Generated<Date>;
  };
  /** Population courante d'une classe de PNJ dans une cité ; une clôture la fait évoluer une fois. */
  'game.npc_population': {
    world_id: ColumnType<string, string, never>;
    city_id: ColumnType<string, string, never>;
    class_id: ColumnType<string, string, never>;
    population: number;
    /** Dernière clôture qui l'a fait évoluer et couverture retenue : nulles à la création. */
    closed_day: ColumnType<number | null, never, number>;
    coverage_bps: ColumnType<number | null, never, number>;
  };
  /** Unités de biens vitaux demandées et servies à une classe, cumulées par les ticks d'un jour de jeu. */
  'game.npc_vital_coverage': {
    world_id: ColumnType<string, string, never>;
    city_id: ColumnType<string, string, never>;
    class_id: ColumnType<string, string, never>;
    game_day: ColumnType<number, number, never>;
    served: number;
    demanded: number;
  };
  'game.ticks': {
    world_id: string;
    /** `bigint` : lu en texte, écrit en nombre (un indice de tick tient dans un entier sûr). */
    index: ColumnType<string, number, never>;
    scheduled_at: Date;
    seed: string;
    config_version_id: string;
    daily_close: boolean;
    season_switch: boolean;
    summary: ColumnType<unknown, string, never>;
    finished_at: Generated<Date>;
  };
  /** Tentatives de clôture quotidienne d'un monde, réussies ou non (Vigie). */
  'telemetry.close_runs': {
    id: Generated<string>;
    world_id: string;
    game_day: number;
    status: 'done' | 'skipped' | 'failed';
    duration_ms: number;
    error: string | null;
    created_at: Generated<Date>;
  };

  'telemetry.tick_runs': {
    id: Generated<string>;
    world_id: string;
    tick_index: ColumnType<string, number, never>;
    status: 'done' | 'skipped' | 'failed';
    duration_ms: number;
    error: string | null;
    created_at: Generated<Date>;
  };

  /** Appels de la passerelle IA (ADR 0005) : jamais de texte, seulement jetons, coût estimé et issue. */
  'telemetry.ai_calls': {
    id: Generated<string>;
    usage: 'oracle' | 'chronicle' | 'steward';
    model: string;
    input_tokens: number;
    output_tokens: number;
    cost_micro_euros: ColumnType<string, number, never>;
    outcome: 'ok' | 'capped' | 'timeout' | 'invalid' | 'error';
    duration_ms: number;
    called_at: Date;
    created_at: Generated<Date>;
  };
  /** Refus avant exécution, comptés par heure, sans contenu de requête. */
  'telemetry.api_refusals': {
    bucket: ColumnType<Date, string, never>;
    kind: 'command' | 'admin_read';
    reason: 'unauthenticated' | 'payload_too_large' | 'rate_limited' | 'forbidden';
    count: ColumnType<string, number, number>;
  };
  /** Fenêtres de limite de débit, partagées entre répliques de l'API. */
  'telemetry.rate_windows': {
    key: string;
    window_start: ColumnType<Date, string, never>;
    count: number;
  };
  /** Lectures du back-office par un compte admis. */
  'telemetry.admin_reads': {
    id: Generated<string>;
    user_id: string;
    admin_role: string;
    route: string;
    status: number;
    created_at: Generated<Date>;
  };

  /** Rôles du back-office : un compte sans ligne n'a aucun accès. */
  'admin.roles': {
    user_id: string;
    role:
      'super_admin' | 'game_designer' | 'community_manager' | 'moderator' | 'support' | 'observer';
    granted_by: string | null;
    granted_at: Generated<Date>;
  };
  'config.versions': {
    id: Generated<string>;
    number: GeneratedAlways<number>;
    /** `jsonb` : lu désérialisé, écrit sous forme de texte JSON. */
    payload: ColumnType<unknown, string, never>;
    note: Generated<string>;
    created_by: string | null;
    created_at: Generated<Date>;
  };
  'config.activations': {
    id: Generated<string>;
    seq: GeneratedAlways<string>;
    version_id: string;
    /** Par défaut : immédiatement, à l'horloge de la base. */
    activate_at: Generated<Date>;
    created_by: string | null;
    /** Toujours l'heure de la base, posée par sa garde : le service n'a pas le droit de l'écrire. */
    created_at: GeneratedAlways<Date>;
  };
  /** Annulation d'une programmation à venir : en ajout seul, l'instant est posé par la base. */
  'config.activation_cancellations': {
    activation_id: string;
    cancelled_by: string;
    cancelled_at: Generated<Date>;
  };
}

export type Db = Kysely<GameDatabase>;

export function createDb(connectionString: string, pool: { max?: number } = {}): Db {
  const connections = new pg.Pool({ connectionString, ...pool });
  // Une connexion inactive fermée par Postgres (redémarrage, bascule) émet `error` sur le pool : sans
  // écouteur, le processus s'arrêterait. Le pool rouvre une connexion à la requête suivante.
  connections.on('error', (error) => console.error('Database pool error', error));
  // Une connexion prêtée (transaction en cours) n'est plus couverte par l'écouteur du pool : `pg-pool`
  // le retire au prêt, et le pilote Kysely n'en pose pas. Si la base la ferme (redémarrage, bascule,
  // `pg_terminate_backend`), `pg` émet `error` sur le client, ce qui arrêterait le processus. La requête
  // en cours échoue de son côté ; le pool écarte la connexion morte et en rouvre une à la suite.
  connections.on('connect', (client) =>
    client.on('error', (error) => console.error('Database connection error', error)),
  );
  return new Kysely<GameDatabase>({
    dialect: new PostgresDialect({ pool: connections }),
  });
}

/**
 * Rôle de service de l'API et du moteur (migration 12) : aucun droit de propriété, écritures par les
 * journaux seulement. En production, le compte de connexion des services en est membre.
 */
export const SERVICE_ROLE = 'oikos_service';

/**
 * Adresse de connexion qui prend le rôle de service dès l'ouverture (`SET ROLE`). Sert en local et dans
 * les tests, où l'on se connecte avec le propriétaire des tables.
 */
export function serviceRoleUrl(connectionString: string): string {
  const url = new URL(connectionString);
  url.searchParams.set('options', `-c role=${SERVICE_ROLE}`);
  return url.toString();
}

/** Nom de la contrainte violée (unicité 23505 ou vérification 23514), ou `null` pour toute autre erreur. */
export function violatedConstraint(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const { code, constraint } = error as { code?: unknown; constraint?: unknown };
  const isViolation = code === '23505' || code === '23514';
  return isViolation && typeof constraint === 'string' ? constraint : null;
}
