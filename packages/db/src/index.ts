/** Accès typé à la base pour l'API de jeu et le moteur (Kysely). */
import type {
  Blazon,
  DecreeModel,
  HonorReason,
  LiturgyGenre,
  OstracismOutcome,
} from '@oikos/contracts';
import {
  Kysely,
  PostgresDialect,
  sql,
  type ColumnType,
  type Generated,
  type GeneratedAlways,
} from 'kysely';
import pg from 'pg';

/** Cause d'une ligne du journal de l'Hybris (#734), comme `HUBRIS_CAUSES` de `@oikos/sim`. */
export type HubrisCauseCode =
  'market_share' | 'wealth' | 'liturgy_levied' | 'offering' | 'liturgy_performed' | 'decay';

export * from './bank-vaults';
export * from './city-rates';
export * from './honor';
export * from './npc-purses';
export * from './sanctions';

/** Issue de l'essai de réécriture d'un oracle par l'IA (7.3, #270) : celle de la passerelle, hors usage coupé. */
export type OracleRewriteOutcome = 'ok' | 'invalid' | 'timeout' | 'error' | 'capped';

/** Tables du schéma `game`. À remplacer par les types générés quand le schéma grossira. */
export interface GameDatabase {
  'game.worlds': {
    id: Generated<string>;
    slug: string;
    name: string;
    /** Graine des événements du monde (#267) : tirée par la base à la création, sauf graine donnée ; immuable. */
    seed: ColumnType<string, string | undefined, never>;
    created_at: Generated<Date>;
  };
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
    /** Compte du joueur ; nul pour une maison PNJ, et seulement pour elle (`houses_account_by_kind`, #715). */
    user_id: string | null;
    name: string;
    /** Colonne générée : `lower(name)`. */
    name_key: GeneratedAlways<string>;
    /** `jsonb` : lu désérialisé, écrit sous forme de texte JSON. */
    blazon: ColumnType<Blazon, string, string>;
    created_at: Generated<Date>;
    /** Nature (#718) : maison de joueur, ou maison PNJ de secours (#715), écartée des classements de fortune. */
    kind: Generated<'player' | 'npc'>;
  };
  /**
   * Citoyenneté d'une maison : elle naît métèque, maintenant, et la clôture la fait citoyenne (garde de
   * la base). Le service n'écrit à la fondation que la maison et la cité.
   */
  /** Maison PNJ de secours d'une filière d'une cité (#715) : une par cité et par filière, fondée par la clôture. */
  'game.npc_houses': {
    house_id: ColumnType<string, string, never>;
    world_id: ColumnType<string, string, never>;
    city_id: ColumnType<string, string, never>;
    chain_id: ColumnType<string, string, never>;
    founded_at: ColumnType<Date, never, never>;
  };
  /**
   * Mémoire du retrait d'une maison PNJ (#717) : dernière clôture jouée (jour de jeu, strictement croissant), rang du
   * dernier échange compté, ventes des dernières clôtures, série au-dessus du seuil haut, dissolution, définitive.
   */
  'game.npc_house_retreats': {
    house_id: ColumnType<string, string, never>;
    world_id: ColumnType<string, string, never>;
    game_day: ColumnType<number, number, number>;
    trade_seq: ColumnType<string, number | string, number | string>;
    /** `[ventes des joueurs, ventes en tout]` par clôture, la plus récente en dernier. */
    sales: ColumnType<[number, number][], string | undefined, string>;
    above_days: ColumnType<number, number | undefined, number>;
    dissolved_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
    updated_at: ColumnType<Date, never, never>;
  };
  /**
   * File des règles d'un site d'une maison PNJ (#716) : sa dernière opération, clé d'idempotence (tick, rang) et
   * position de la file ; tick et rang ne font que croître (garde de la base). Rien n'en est lu par les joueurs.
   */
  'game.npc_site_queues': {
    site_id: ColumnType<string, string, never>;
    world_id: ColumnType<string, string, never>;
    house_id: ColumnType<string, string, never>;
    config_version_id: ColumnType<string, string, string>;
    tick_index: ColumnType<string, number, number>;
    rank: ColumnType<number, number, number>;
    rule_position: ColumnType<number, number, number>;
    error_code: ColumnType<string | null, string | null, string | null>;
    /** Dernier tick de refus de chaque règle de la version, par position. */
    refused: ColumnType<Record<string, number>, string, string>;
    updated_at: ColumnType<Date, never, never>;
  };

  'game.citizenships': {
    id: ColumnType<string, never, never>;
    house_id: ColumnType<string, string, never>;
    city_id: ColumnType<string, string, never>;
    status: ColumnType<'metic' | 'citizen', never, 'citizen'>;
    since: ColumnType<Date, never, Date>;
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
    /** Intendant qui a mené la commande au nom de la maison du compte (#279) ; nul pour le joueur. */
    steward_id?: string | null;
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
    /** Trésor ou bourse des PNJ de la cité (`kind = 'treasury'`) : sa cité ; nul pour tout autre compte. */
    city_id: Generated<string | null>;
    /**
     * Bourse des PNJ de la cité (#632), invisible au service : il la lit par `lockNpcPurses` ou
     * `game.npc_purses()`.
     */
    npc_purse: Generated<boolean>;
    /**
     * Coffre d'une banque de joueur (#726) : sa banque, et sa cité dans `city_id` ; invisible au service, qui le
     * verrouille par `lockBankVault`. Nul pour tout autre compte.
     */
    bank_id: ColumnType<string | null, never, never>;
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
    /** Nature de la ligne (4.1), écrite à l'insertion seulement ; nulle : celle de son écriture. */
    nature: ColumnType<'upkeep' | 'wages' | null, 'upkeep' | 'wages' | null | undefined, never>;
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
    /** Voyage d'un mouvement vers ou depuis l'extrémité `in_transit` (4.6) ; nul pour tout autre. */
    voyage_id?: string | null;
    /** Offrande d'un mouvement vers l'extrémité `offering` (7.1) ; nul pour tout autre. */
    offering_id?: string | null;
    /** Grâce dont un mouvement `grace.surplus` est le surplus, venu de `production` (7.1, #266). */
    grace_use_id?: string | null;
    created_at: Generated<Date>;
  };
  /** Offrandes (7.1, #265) : écrites une fois par `temple.makeOffering`, immuables (garde de la base). */
  'game.offerings': {
    id: ColumnType<string, never, never>;
    world_id: ColumnType<string, string, never>;
    house_id: ColumnType<string, string, never>;
    city_id: ColumnType<string, string, never>;
    god_id: ColumnType<string, string, never>;
    oboles: ColumnType<string, number, never>;
    charis: ColumnType<string, number, never>;
    ledger_entry_id: ColumnType<string | null, string | null, never>;
    created_at: ColumnType<Date, never, never>;
  };
  /** Charis d'une maison envers un dieu : le cumul de `game.favor_ledger`, jamais écrite à la main. */
  'game.favor': {
    house_id: ColumnType<string, never, never>;
    god_id: ColumnType<string, never, never>;
    world_id: ColumnType<string, never, never>;
    /** `update` ne sert qu'à verrouiller la ligne (`for update`) : la garde refuse toute modification. */
    charis: ColumnType<string, never, never>;
  };
  /**
   * Journal de la Charis, en ajout seul : une offrande (`offering`), le déclin d'une clôture (`decay`) ou la
   * Charis dépensée par une grâce (`grace`, #266).
   */
  'game.favor_ledger': {
    id: ColumnType<string, never, never>;
    world_id: ColumnType<string, string, never>;
    house_id: ColumnType<string, string, never>;
    god_id: ColumnType<string, string, never>;
    amount: ColumnType<string, number, never>;
    kind: ColumnType<
      'offering' | 'decay' | 'grace' | 'liturgy',
      'offering' | 'decay' | 'grace' | 'liturgy',
      never
    >;
    /** Offrande d'une ligne `offering` ; nulle pour toute autre. */
    offering_id: ColumnType<string | null, string | null | undefined, never>;
    /** Invocation d'une ligne `grace` ; nulle pour toute autre. */
    grace_use_id: ColumnType<string | null, string | null | undefined, never>;
    /** Liturgie accomplie d'une ligne `liturgy` (#720) ; nulle pour toute autre. */
    liturgy_id: ColumnType<string | null, string | null | undefined, never>;
    game_day: ColumnType<number | null, number | null | undefined, never>;
    created_at: ColumnType<Date, never, never>;
  };
  /** Timè d'une maison (4.1, #704) : le cumul de `game.honor_ledger`, jamais écrite à la main. */
  'game.honor': {
    house_id: ColumnType<string, never, never>;
    world_id: ColumnType<string, never, never>;
    honor: ColumnType<string, never, never>;
  };
  /**
   * Journal de la Timè, en ajout seul : une ligne au plus par motif et par référence (`honor_ledger_once`). Qui
   * l'écrit prend d'abord le verrou consultatif `honor:<maison>`, puis lit la Timè pour la tenir dans ses bornes.
   */
  'game.honor_ledger': {
    id: ColumnType<string, never, never>;
    world_id: ColumnType<string, string, never>;
    house_id: ColumnType<string, string, never>;
    amount: ColumnType<string, number, never>;
    reason: ColumnType<HonorReason, HonorReason, never>;
    reference: ColumnType<string, string, never>;
    game_day: ColumnType<number, number, never>;
    created_at: ColumnType<Date, never, never>;
  };
  /** Jauge d'Hybris d'une maison de joueur (7.2, #734) : le cumul de `game.hubris_ledger`, jamais lue par un client. */
  'game.hubris': {
    house_id: ColumnType<string, never, never>;
    world_id: ColumnType<string, never, never>;
    gauge: ColumnType<string, never, never>;
  };
  /**
   * Journal de l'Hybris, en ajout seul, écrit par la seule clôture : une ligne au plus par maison, cause et jour de jeu
   * (`hubris_ledger_once`) ; un gain est positif, une baisse négative (garde de la base).
   */
  'game.hubris_ledger': {
    id: ColumnType<string, never, never>;
    world_id: ColumnType<string, string, never>;
    house_id: ColumnType<string, string, never>;
    amount: ColumnType<string, number, never>;
    cause: ColumnType<HubrisCauseCode, HubrisCauseCode, never>;
    game_day: ColumnType<number, number, never>;
    created_at: ColumnType<Date, never, never>;
  };
  /**
   * Grâces invoquées (7.1, #266) : écrites par `temple.invokeGrace`, puis consommées une fois par une récolte
   * (`site_id`) ou un départ (`voyage_id`) ; rien d'autre ne change (garde de la base).
   */
  'game.graces_used': {
    id: ColumnType<string, never, never>;
    world_id: ColumnType<string, string, never>;
    house_id: ColumnType<string, string, never>;
    grace_id: ColumnType<string, string, never>;
    god_id: ColumnType<string, string, never>;
    effect: ColumnType<
      'blessed_harvest' | 'inspired_workshop' | 'fair_wind',
      'blessed_harvest' | 'inspired_workshop' | 'fair_wind',
      never
    >;
    magnitude_bps: ColumnType<number, number, never>;
    charis_spent: ColumnType<string, number, never>;
    invoked_at: ColumnType<Date, never, never>;
    ready_at: ColumnType<Date, Date, never>;
    consumed_at: ColumnType<Date | null, never, Date>;
    site_id: ColumnType<string | null, never, string>;
    voyage_id: ColumnType<string | null, never, string>;
    saved_seconds: ColumnType<number | null, never, number>;
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
    /** Intendant qui a posé l'ordre, de la même maison et en poste à la pose ; nul pour un ordre du joueur. */
    steward_id: ColumnType<string | null, string | null | undefined, never>;
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
    /**
     * Instant de la fermeture d'un site d'une maison PNJ par le retrait (#717) ; nul s'il est ouvert. Un site naît
     * ouvert ; fermé, il ne change plus jusqu'à sa réouverture (garde de la base).
     */
    closed_at: ColumnType<Date | null, never, Date | null>;
    created_at: Generated<Date>;
  };
  /** Navires des maisons (4.6). Le service crée un navire, il ne choisit ni sa date ni son désarmement. */
  'game.ships': {
    id: ColumnType<string, never, never>;
    world_id: ColumnType<string, string, never>;
    house_id: ColumnType<string, string, never>;
    class_id: ColumnType<string, string, never>;
    /**
     * Cité où le navire est à quai ; nulle en mer. Un navire naît à quai, ne prend la mer que par un voyage
     * qui part et n'accoste qu'à son arrivée (garde de la base).
     */
    docked_city_id: ColumnType<string | null, string, string | null>;
    /**
     * Instant du désarmement, entretien impayé ; nul pour un navire armé. Un navire naît armé ; le
     * désarmement est daté de la transaction qui l'écrit (garde de la base).
     */
    laid_up_at: ColumnType<Date | null, never, Date | null>;
    created_at: ColumnType<Date, never, never>;
  };
  /**
   * Intendants des maisons (4.4, #278), un par site en poste. Le service embauche sans choisir ni la date ni
   * l'impayé (posé à l'embauche), puis ne change que l'impayé (clôture) et le renvoi (garde de la base).
   */
  'game.stewards': {
    id: ColumnType<string, never, never>;
    world_id: ColumnType<string, string, never>;
    house_id: ColumnType<string, string, never>;
    site_id: ColumnType<string, string, never>;
    name: ColumnType<string, string, never>;
    hired_at: ColumnType<Date, never, never>;
    /** Impayé depuis cet instant (l'intendant n'agit pas) ; nul quand la dernière clôture l'a payé. */
    unpaid_since: ColumnType<Date | null, never, Date | null>;
    dismissed_at: ColumnType<Date | null, never, Date>;
    /** Révision en vigueur de ses règles ; 0 : aucune. Elle n'avance que d'un pas à la fois. */
    rules_revision: ColumnType<number, never, number>;
    /** Instant de la transaction qui a ouvert la révision en vigueur, posé par la garde. */
    rules_revised_at: ColumnType<Date | null, never, never>;
  };
  /** Règles d'un intendant par révision : écrites dans la révision en vigueur, jamais modifiées ni effacées. */
  'game.steward_rules': {
    steward_id: ColumnType<string, string, never>;
    revision: ColumnType<number, number, never>;
    position: ColumnType<number, number, never>;
    kind: ColumnType<'collect' | 'sell' | 'buy', 'collect' | 'sell' | 'buy', never>;
    good_id: ColumnType<string | null, string | null, never>;
    /** Prix plancher d'une vente, plafond d'un rachat, par unité ; nul pour une récolte. */
    price_oboles: ColumnType<string | null, number | null, never>;
    /** Réserve gardée par une vente, stock cible d'un rachat ; nul pour une récolte. */
    units: ColumnType<string | null, number | null, never>;
  };
  /**
   * Opérations des intendants (#279) : une par intendant, tick et rang, inscrite avec la ligne du journal des
   * commandes qu'elle nomme, jamais modifiée (garde de la base).
   */
  'game.steward_operations': {
    id: ColumnType<string, never, never>;
    world_id: ColumnType<string, string, never>;
    steward_id: ColumnType<string, string, never>;
    tick_index: ColumnType<string, number, never>;
    rank: ColumnType<number, number, never>;
    rules_revision: ColumnType<number, number, never>;
    rule_position: ColumnType<number, number, never>;
    status: ColumnType<'ok' | 'rejected', 'ok' | 'rejected', never>;
    error_code: ColumnType<string | null, string | null, never>;
    summary: ColumnType<unknown, string, never>;
    command_id: ColumnType<string, string, never>;
    created_at: ColumnType<Date, never, never>;
  };
  /**
   * Consignes d'intendant en langage naturel (#280) : une en attente par intendant, répondue une fois par sa
   * proposition ; le texte n'est effacé que par la purge de la conservation (garde de la base).
   */
  'game.steward_instructions': {
    id: ColumnType<string, never, never>;
    steward_id: ColumnType<string, string, never>;
    /** Révision des règles que le joueur avait sous les yeux en écrivant la consigne. */
    rules_revision: ColumnType<number, number, never>;
    text: ColumnType<string | null, string, never>;
    status: ColumnType<'pending' | 'answered', never, 'answered'>;
    created_at: ColumnType<Date, never, never>;
    answered_at: ColumnType<Date | null, never, never>;
  };
  /** Réponse du moteur à une consigne : règles proposées et simulation, ou refus ; jamais modifiée. */
  'game.steward_proposals': {
    instruction_id: ColumnType<string, string, never>;
    rules: ColumnType<unknown, string | null, never>;
    simulation: ColumnType<unknown, string | null, never>;
    refusal: ColumnType<string | null, string | null, never>;
    created_at: ColumnType<Date, never, never>;
  };
  /**
   * Parc de logements d'une cité (4.5). Le moteur crée un bien neuf, à la cité ; la base n'en change le
   * propriétaire que par une écriture d'achat, et n'en relève l'état que par une rénovation.
   */
  'game.properties': {
    id: ColumnType<string, never, never>;
    world_id: ColumnType<string, string, never>;
    city_id: ColumnType<string, string, never>;
    size_id: ColumnType<string, string, never>;
    lot: ColumnType<number, number, never>;
    owner_house_id: ColumnType<string | null, never, string>;
    /** Instant de l'achat, posé par la base avec le propriétaire. */
    acquired_at: ColumnType<Date | null, never, never>;
    condition: ColumnType<number, never, number>;
    worn_day: ColumnType<number | null, never, number>;
    upkeep_unpaid_since: ColumnType<Date | null, never, Date | null>;
    created_at: ColumnType<Date, never, never>;
  };
  /**
   * Offres d'un bien par sa maison (4.5, #257) : vente à prix affiché ou location au loyer quotidien. Une
   * offre ouverte par bien ; elle se ferme une fois, datée par la base (garde).
   */
  'game.property_listings': {
    id: ColumnType<string, never, never>;
    world_id: ColumnType<string, string, never>;
    property_id: ColumnType<string, string, never>;
    house_id: ColumnType<string, string, never>;
    kind: ColumnType<'sale' | 'lease', 'sale' | 'lease', never>;
    /** `bigint` : lu en texte. */
    price_oboles: ColumnType<string, number, never>;
    created_at: ColumnType<Date, never, never>;
    closed_at: ColumnType<Date | null, never, never>;
    outcome: ColumnType<
      'withdrawn' | 'sold' | 'leased' | null,
      never,
      'withdrawn' | 'sold' | 'leased'
    >;
    /** Écriture `property.sale` d'une offre vendue. */
    ledger_entry_id: ColumnType<string | null, never, string>;
  };
  /**
   * Baux (4.5, #257) : termes immuables ; la fin se demande une fois, puis prend effet dans la transaction
   * de la clôture de son jour, datée par la base (garde).
   */
  'game.leases': {
    id: ColumnType<string, never, never>;
    world_id: ColumnType<string, string, never>;
    property_id: ColumnType<string, string, never>;
    listing_id: ColumnType<string, string, never>;
    landlord_house_id: ColumnType<string, string, never>;
    tenant_house_id: ColumnType<string, string, never>;
    /** `bigint` : lu en texte. */
    rent_oboles: ColumnType<string, number, never>;
    started_at: ColumnType<Date, never, never>;
    end_requested_at: ColumnType<Date | null, never, never>;
    end_requested_by: ColumnType<'landlord' | 'tenant' | null, never, 'landlord' | 'tenant'>;
    ended_at: ColumnType<Date | null, never, never>;
    ended_day: ColumnType<number | null, never, number>;
    end_reason: ColumnType<'requested' | 'unpaid' | null, never, 'requested' | 'unpaid'>;
  };
  /**
   * Marché du travail d'une cité pour un jour de jeu (4.4, #258) : écrit une fois par la clôture qui ouvre
   * ce jour, immuable ensuite (garde de la base). Montants et effectifs `bigint` : lus en texte.
   */
  'game.labor_market': {
    world_id: ColumnType<string, string, never>;
    city_id: ColumnType<string, string, never>;
    game_day: ColumnType<number, number, never>;
    /** Offre de travail ; nulle : sans limite. */
    supply: ColumnType<string | null, number | null, never>;
    employed: ColumnType<string, number, never>;
    unhoused: ColumnType<string, number, never>;
    wage_oboles: ColumnType<string, number, never>;
    lodging_oboles: ColumnType<string, number, never>;
    created_at: ColumnType<Date, never, never>;
  };
  /** Événements du monde (#267) : planifiés par la clôture avant leur début, immuables (garde de la base). */
  'game.world_events': {
    id: ColumnType<string, never, never>;
    world_id: ColumnType<string, string, never>;
    model: ColumnType<'drought' | 'good_year' | 'storm' | 'caravan', string, never>;
    city_id: ColumnType<string, string, never>;
    other_city_id: ColumnType<string | null, string | null, never>;
    good_id: ColumnType<string | null, string | null, never>;
    planned_day: ColumnType<number, number, never>;
    start_day: ColumnType<number, number, never>;
    /** Premier jour de jeu qui n'est plus sous l'événement. */
    end_day: ColumnType<number, number, never>;
    starts_at: ColumnType<Date, Date, never>;
    ends_at: ColumnType<Date, Date, never>;
    magnitude_bps: ColumnType<number, number, never>;
    seed: ColumnType<string, string, never>;
    created_at: ColumnType<Date, never, never>;
  };
  /** Chronique d'une cité à une clôture (#271) : écrite une fois par le moteur, jamais modifiée. */
  'game.chronicle_articles': {
    id: ColumnType<string, never, never>;
    world_id: ColumnType<string, string, never>;
    city_id: ColumnType<string, string, never>;
    /** Jour de jeu de la clôture qui la publie. */
    game_day: ColumnType<number, number, never>;
    /** `jsonb` : lu désérialisé, écrit sous forme de texte JSON. */
    facts: ColumnType<unknown, string, never>;
    text_fr: ColumnType<string, string, never>;
    text_en: ColumnType<string, string, never>;
    source: ColumnType<'ai' | 'fallback', 'ai' | 'fallback', never>;
    created_at: ColumnType<Date, never, never>;
  };
  /**
   * Oracle d'un événement (7.3, #270) : écrit en repli avec son événement, réécrit au plus une fois par l'IA avant
   * qu'il commence (garde de la base).
   */
  'game.oracles': {
    id: ColumnType<string, never, never>;
    world_id: ColumnType<string, string, never>;
    event_id: ColumnType<string, string, never>;
    text_fr: ColumnType<string, string, string>;
    text_en: ColumnType<string, string, string>;
    source: ColumnType<'ai' | 'fallback', never, 'ai' | 'fallback'>;
    /** Essai de réécriture : daté de sa transaction (`now()`), une fois. */
    rewritten_at: ColumnType<Date | null, never, Date>;
    rewrite_outcome: ColumnType<OracleRewriteOutcome | null, never, OracleRewriteOutcome>;
    created_at: ColumnType<Date, never, never>;
  };
  /** Consultation de la Pythie (7.3, #270) : payée par une offrande, elle rend des oracles ; immuable. */
  'game.oracle_consultations': {
    id: ColumnType<string, never, never>;
    world_id: ColumnType<string, string, never>;
    house_id: ColumnType<string, string, never>;
    city_id: ColumnType<string, string, never>;
    offering_id: ColumnType<string, string, never>;
    oracle_ids: ColumnType<string[], string[], never>;
    created_at: ColumnType<Date, never, never>;
  };
  /** Effets appliqués des événements : écart de rendement d'une récolte, retard d'un départ (audit). */
  'game.event_effects': {
    id: ColumnType<string, never, never>;
    world_id: ColumnType<string, string, never>;
    event_id: ColumnType<string, string, never>;
    kind: ColumnType<'site_yield' | 'voyage_delay', string, never>;
    site_id: ColumnType<string | null, string | null | undefined, never>;
    voyage_id: ColumnType<string | null, string | null | undefined, never>;
    good_id: ColumnType<string | null, string | null | undefined, never>;
    /** `bigint` : lu en texte. */
    quantity: ColumnType<string | null, number | null | undefined, never>;
    delay_seconds: ColumnType<number | null, number | null | undefined, never>;
    created_at: ColumnType<Date, never, never>;
  };
  /** Élections (6.2) : la clôture les ouvre et les dépouille ; calendrier immuable (garde de la base). */
  'game.elections': {
    id: ColumnType<string, never, never>;
    world_id: ColumnType<string, string, never>;
    city_id: ColumnType<string, string, never>;
    office: ColumnType<'archon', 'archon', never>;
    candidacy_opens_at: ColumnType<Date, Date, never>;
    voting_opens_at: ColumnType<Date, Date, never>;
    /** Fin du vote, début du mandat pourvu. */
    voting_closes_at: ColumnType<Date, Date, never>;
    term_ends_at: ColumnType<Date, Date, never>;
    /** Instant du dépouillement, une fois, daté de la transaction (garde). */
    tallied_at: ColumnType<Date | null, never, Date>;
    created_at: ColumnType<Date, never, never>;
  };
  /** Candidatures : datées par la base ; elles ne changent que par leur retrait. */
  'game.candidacies': {
    id: ColumnType<string, never, never>;
    election_id: ColumnType<string, string, never>;
    house_id: ColumnType<string, string, never>;
    created_at: ColumnType<Date, never, never>;
    withdrawn_at: ColumnType<Date | null, never, Date>;
  };
  /** Bulletins : un par maison et par élection, datés par la base, définitifs. */
  'game.ballots': {
    id: ColumnType<string, never, never>;
    election_id: ColumnType<string, string, never>;
    house_id: ColumnType<string, string, never>;
    candidacy_id: ColumnType<string, string, never>;
    cast_at: ColumnType<Date, never, never>;
  };
  /** Charges pourvues par le dépouillement de leur élection, définitives. */
  'game.offices': {
    id: ColumnType<string, never, never>;
    world_id: ColumnType<string, string, never>;
    city_id: ColumnType<string, string, never>;
    office: ColumnType<'archon', 'archon', never>;
    house_id: ColumnType<string, string, never>;
    election_id: ColumnType<string, string, never>;
    starts_at: ColumnType<Date, Date, never>;
    ends_at: ColumnType<Date, Date, never>;
    /** Charge quittée avant son terme par un archonte ostracisé (#722), datée par la base, une fois. */
    vacated_at: ColumnType<Date | null, never, Date>;
  };
  /**
   * Décrets (6.3) : proposés par l'archonte en charge, dépouillés une fois par la clôture, qui écrit l'état,
   * la date et le décompte que la base recompte (garde).
   */
  'game.decrees': {
    id: ColumnType<string, never, never>;
    world_id: ColumnType<string, string, never>;
    city_id: ColumnType<string, string, never>;
    model: ColumnType<DecreeModel, DecreeModel, never>;
    /** `jsonb` : lu désérialisé, écrit sous forme de texte JSON. */
    params: ColumnType<unknown, string, never>;
    office_id: ColumnType<string, string, never>;
    proposed_by: ColumnType<string, string, never>;
    status: ColumnType<
      'proposed' | 'adopted' | 'rejected' | 'applied' | 'lapsed',
      never,
      'adopted' | 'rejected' | 'applied' | 'lapsed'
    >;
    proposed_at: ColumnType<Date, never, never>;
    voting_closes_at: ColumnType<Date, Date, never>;
    quorum_bps: ColumnType<number, number, never>;
    tallied_at: ColumnType<Date | null, never, Date>;
    electorate: ColumnType<number | null, never, number>;
    votes_for: ColumnType<number | null, never, number>;
    votes_against: ColumnType<number | null, never, number>;
    /** Application d'un décret (taux ou dépense), datée par la base (`now()`), une fois. */
    applied_at: ColumnType<Date | null, never, Date>;
    /**
     * Jour de jeu de la clôture qui a réglé un décret de dépense (#263), appliqué ou caduc (`lapsed`) : la
     * base exige que la transaction enregistre la clôture de ce jour. Nul pour un décret de taux.
     */
    settled_day: ColumnType<number | null, never, number>;
  };
  /** Votes sur un décret : un par maison, datés par la base, définitifs. */
  'game.decree_votes': {
    id: ColumnType<string, never, never>;
    decree_id: ColumnType<string, string, never>;
    house_id: ColumnType<string, string, never>;
    approve: ColumnType<boolean, boolean, never>;
    cast_at: ColumnType<Date, never, never>;
  };
  /**
   * Votes d'ostracisme (6.4, #722), ouverts par un décret `ostracism` adopté, avec les règles de la clôture qui
   * les ouvre ; dépouillés une fois par la clôture, dont la base recompte l'issue (garde).
   */
  'game.ostracisms': {
    id: ColumnType<string, never, never>;
    world_id: ColumnType<string, string, never>;
    city_id: ColumnType<string, string, never>;
    decree_id: ColumnType<string, string, never>;
    /** Ouverture, datée par la base : base de l'écart entre deux ostracismes d'une cité. */
    opened_at: ColumnType<Date, never, never>;
    voting_closes_at: ColumnType<Date, Date, never>;
    quorum_bps: ColumnType<number, number, never>;
    ostracism_days: ColumnType<number, number, never>;
    tallied_at: ColumnType<Date | null, never, Date>;
    electorate: ColumnType<number | null, never, number>;
    ballots: ColumnType<number | null, never, number>;
    outcome: ColumnType<OstracismOutcome | null, never, OstracismOutcome>;
    ostracized_house_id: ColumnType<string | null, never, string>;
    /** Fin de l'ostracisme : la clôture `ostracism_days` jours de jeu après celle du dépouillement. */
    ends_at: ColumnType<Date | null, never, Date>;
  };
  /**
   * Liturgies (6.4, #719) : une par maison désignée et par saison, écrite par la clôture de bascule de saison, datée
   * par la base, désignée (`assigned`) à sa naissance. Le dû (oboles) se lit en texte, comme tout `bigint`. Réglée une
   * fois (#720) : accomplie (`performed`) ou prélevée d'office (`levied`), datée par la base (`settled_at`).
   */
  'game.liturgies': {
    id: ColumnType<string, never, never>;
    world_id: ColumnType<string, string, never>;
    city_id: ColumnType<string, string, never>;
    house_id: ColumnType<string, string, never>;
    season: ColumnType<number, number, never>;
    genre: ColumnType<LiturgyGenre, LiturgyGenre, never>;
    due: ColumnType<string, string, never>;
    designated_day: ColumnType<number, number, never>;
    due_day: ColumnType<number, number, never>;
    due_at: ColumnType<Date, Date, never>;
    status: ColumnType<'assigned' | 'performed' | 'levied', never, 'performed' | 'levied'>;
    created_at: ColumnType<Date, never, never>;
    /** Faste payé au-delà du dû ; zéro pour un prélèvement. */
    splendor: ColumnType<string | null, never, number>;
    /** Oboles payées : dû plus faste, ou ce que la trésorerie a couvert. */
    paid: ColumnType<string | null, never, number>;
    /** Dieu protecteur et Charis gagnée d'un accomplissement ; nuls sans Charis. */
    god_id: ColumnType<string | null, never, string | null>;
    charis_gained: ColumnType<string | null, never, number | null>;
    settled_day: ColumnType<number | null, never, number>;
    settled_at: ColumnType<Date | null, never, never>;
    /** Écriture `liturgy.perform` ou `liturgy.levy` ; nulle pour un prélèvement qui n'a rien trouvé. */
    ledger_entry_id: ColumnType<string | null, never, string | null>;
  };
  /**
   * Banques de joueurs (5.4, #726) : une au plus par maison de joueur, dans la cité de sa citoyenneté, datée par la base.
   * Son coffre est un compte ouvert par la base à la fondation (`game.accounts.bank_id`) ; le droit payé
   * (`charter_fee`, oboles, lu en texte) l'est par une écriture `bank.charter` s'il n'est pas nul.
   */
  'game.banks': {
    id: ColumnType<string, never, never>;
    world_id: ColumnType<string, string, never>;
    city_id: ColumnType<string, string, never>;
    house_id: ColumnType<string, string, never>;
    name: ColumnType<string, string, never>;
    /** Taux affichés : `bank.setRates` (#727) les change, dans les bornes du monde, que la base vérifie. */
    deposit_rate_bps: ColumnType<number, number, number>;
    loan_rate_bps: ColumnType<number, number, number>;
    charter_fee: ColumnType<string, number, never>;
    founded_at: ColumnType<Date, never, never>;
  };
  /**
   * Dépôts (5.4, #727) : la créance d'une maison de joueur sur une banque qui n'est pas la sienne, une par banque et par
   * maison, ouverte vide par le service ; son solde (oboles, lu en texte) ne change que par ses mouvements
   * (`game.bank_deposit_movements`). Le service le verrouille (`forUpdate`) sans pouvoir l'écrire.
   */
  'game.bank_deposits': {
    id: ColumnType<string, never, never>;
    world_id: ColumnType<string, string, never>;
    bank_id: ColumnType<string, string, never>;
    house_id: ColumnType<string, string, never>;
    balance: ColumnType<string, never, never>;
    created_at: ColumnType<Date, never, never>;
  };
  /**
   * Mouvements d'un dépôt (#727), en ajout seul : un dépôt ou un retrait, payé par l'écriture `ledger_entry_id`
   * (`bank.deposit`, `bank.withdraw`), ou l'intérêt du jour `game_day`, sans écriture, écrit par la clôture. La base
   * écrit le taux affiché et, hors intérêt, le jour de jeu ; elle les applique au dépôt.
   */
  'game.bank_deposit_movements': {
    id: ColumnType<string, never, never>;
    world_id: ColumnType<string, string, never>;
    deposit_id: ColumnType<string, string, never>;
    bank_id: ColumnType<string, string, never>;
    house_id: ColumnType<string, string, never>;
    kind: ColumnType<
      'deposit' | 'withdraw' | 'interest',
      'deposit' | 'withdraw' | 'interest',
      never
    >;
    amount: ColumnType<string, number, never>;
    rate_bps: ColumnType<number, never, never>;
    game_day: ColumnType<number | null, number | undefined, never>;
    ledger_entry_id: ColumnType<string | null, string | undefined, never>;
    created_at: ColumnType<Date, never, never>;
  };
  /**
   * Prêts (5.4, #724) : un par emprunt, du Trésor du temple (`temple`) ; décaissé par l'écriture
   * `disbursement_entry_id`, daté par la base. Le reste dû (`outstanding`), les remboursements cumulés et l'état ne
   * changent que par `game.loan_repayments` ; les montants (oboles) se lisent en texte, comme tout `bigint`. Seule la
   * clôture le fait passer en défaut (#725), état et jour du défaut.
   */
  'game.loans': {
    id: ColumnType<string, never, never>;
    world_id: ColumnType<string, string, never>;
    lender: ColumnType<'temple' | 'bank', 'temple', never>;
    borrower_house_id: ColumnType<string, string, never>;
    principal: ColumnType<string, number, never>;
    rate_bps: ColumnType<number, number, never>;
    term_days: ColumnType<number, number, never>;
    interest: ColumnType<string, number, never>;
    borrowed_day: ColumnType<number, number, never>;
    due_day: ColumnType<number, number, never>;
    due_at: ColumnType<Date, Date, never>;
    principal_repaid: ColumnType<string, never, never>;
    interest_repaid: ColumnType<string, never, never>;
    outstanding: ColumnType<string, never, never>;
    status: ColumnType<'active' | 'repaid' | 'defaulted', never, 'defaulted'>;
    defaulted_day: ColumnType<number | null, never, number>;
    disbursement_entry_id: ColumnType<string, string, never>;
    created_at: ColumnType<Date, never, never>;
  };
  /**
   * Remboursements d'un prêt (#724), en ajout seul : intérêts d'abord, puis principal, payés par l'écriture
   * `ledger_entry_id` (`loan.repay`, ou `loan.collect` pour un prélèvement de la clôture) ; la base les applique au prêt.
   */
  'game.loan_repayments': {
    id: ColumnType<string, never, never>;
    world_id: ColumnType<string, string, never>;
    loan_id: ColumnType<string, string, never>;
    house_id: ColumnType<string, string, never>;
    interest: ColumnType<string, number, never>;
    principal: ColumnType<string, number, never>;
    game_day: ColumnType<number, number, never>;
    ledger_entry_id: ColumnType<string, string, never>;
    /** Remboursement de la maison (`repay`), ou prélèvement de la clôture à l'échéance (`collect`, #725). */
    kind: ColumnType<'repay' | 'collect', 'repay' | 'collect' | undefined, never>;
    created_at: ColumnType<Date, never, never>;
  };
  /** Bulletins d'ostracisme : un par maison et par vote, datés par la base, définitifs. */
  'game.ostraca': {
    id: ColumnType<string, never, never>;
    ostracism_id: ColumnType<string, string, never>;
    house_id: ColumnType<string, string, never>;
    target_house_id: ColumnType<string, string, never>;
    cast_at: ColumnType<Date, never, never>;
  };
  /**
   * Canaux de discussion (6.6) : celui d'une cité, né avec elle, ou la conversation privée de deux maisons
   * rangées dans l'ordre (`house_low` < `house_high`). Le service n'ouvre que des conversations privées.
   */
  'game.channels': {
    id: ColumnType<string, never, never>;
    world_id: ColumnType<string, string, never>;
    kind: ColumnType<'city' | 'direct', never, never>;
    city_id: ColumnType<string | null, never, never>;
    house_low: ColumnType<string | null, string, never>;
    house_high: ColumnType<string | null, string, never>;
    created_at: ColumnType<Date, never, never>;
  };
  /** Membres d'une conversation privée : ses deux maisons, inscrites par la base. */
  'game.channel_members': {
    channel_id: ColumnType<string, never, never>;
    house_id: ColumnType<string, never, never>;
    joined_at: ColumnType<Date, never, never>;
  };
  /** Messages : datés par la base, immuables sauf leur masquage (modération), purgés par le moteur. */
  'game.messages': {
    id: ColumnType<string, never, never>;
    channel_id: ColumnType<string, string, never>;
    house_id: ColumnType<string, string, never>;
    body: ColumnType<string, string, never>;
    /** Le texte tant que le message n'est pas masqué, nul ensuite (colonne générée). */
    visible_body: ColumnType<string | null, never, never>;
    created_at: ColumnType<Date, never, never>;
    /** Posé par la modération (#276) : maintenant, une fois (garde de la base). */
    hidden_at: ColumnType<Date | null, never, Date>;
  };
  /**
   * Pré-tri d'un message signalé par l'IA (#763), un essai par message, écrit par le moteur seul après la validation de
   * la sortie du modèle. Une catégorie et un résumé vont ensemble ; sans eux, la ligne garde l'issue du repli. Suit son
   * message à la purge. Jamais lue par une commande de sanction.
   */
  'game.report_triage': {
    message_id: ColumnType<string, string, never>;
    category: ColumnType<
      'likely_violation' | 'doubtful' | 'likely_unfounded' | null,
      'likely_violation' | 'doubtful' | 'likely_unfounded' | null,
      never
    >;
    summary: ColumnType<string | null, string | null, never>;
    outcome: ColumnType<'ok' | 'capped' | 'timeout' | 'invalid' | 'error', string, never>;
    triaged_at: ColumnType<Date, never, never>;
  };

  /**
   * Signalements d'un message (#275) : écrits ouverts, datés par la base ; à la purge du message, `message_id`
   * devient nul. Le service n'écrit ni l'état ni la date.
   */
  'game.reports': {
    id: ColumnType<string, never, never>;
    message_id: ColumnType<string | null, string, never>;
    reported_house_id: ColumnType<string, string, never>;
    house_id: ColumnType<string, string, never>;
    reason: ColumnType<string, string, never>;
    /** Écarté ou retenu par la modération (#276), une fois, par un autre compte que le signalé. */
    state: ColumnType<'open' | 'dismissed' | 'upheld', never, 'dismissed' | 'upheld'>;
    created_at: ColumnType<Date, never, never>;
    /** Instant du traitement, posé par la base. */
    resolved_at: ColumnType<Date | null, never, never>;
    resolved_by: ColumnType<string | null, never, string>;
  };
  /**
   * Voyages (4.6). Le service fait partir un voyage sans en choisir ni l'identifiant ni la date de
   * départ, puis n'écrit que son arrivée.
   */
  'game.voyages': {
    id: ColumnType<string, never, never>;
    world_id: ColumnType<string, string, never>;
    house_id: ColumnType<string, string, never>;
    ship_id: ColumnType<string, string, never>;
    from_city_id: ColumnType<string, string, never>;
    to_city_id: ColumnType<string, string, never>;
    departed_at: ColumnType<Date, never, never>;
    arrives_at: ColumnType<Date, Date, never>;
    arrived_at: ColumnType<Date | null, never, Date>;
    /** Risque de perte de la cargaison fixé au départ, en points de base (#730) ; nul par défaut. */
    loss_risk_bps: ColumnType<number, number | undefined, never>;
  };
  /** Cargaison d'un voyage, écrite à son départ et jamais modifiée. */
  'game.voyage_cargo': {
    voyage_id: ColumnType<string, string, never>;
    world_id: ColumnType<string, string, never>;
    good_id: ColumnType<string, string, never>;
    quantity: ColumnType<string, number, never>;
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

  /** Fraction de demande et budget non dépensé des PNJ reportés d'un tick au suivant, par cité et par bien. */
  'game.npc_demand_carry': {
    world_id: string;
    city_id: string;
    good_id: string;
    carry: number;
    /** Oboles non dépensées du budget des ticks précédents, bornées par la configuration (#675). */
    budget_carry: ColumnType<string, number | undefined, number>;
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
    usage: 'oracle' | 'chronicle' | 'steward' | 'moderation_triage';
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
  /**
   * Sanctions des comptes (#275), lues à chaque commande. Le service prononce une sanction qui commence
   * maintenant (#276), puis n'y écrit que l'appel, la validation d'une exclusion, la décision sur l'appel, la
   * proposition de levée et la levée : la base date chacun et n'en admet qu'un (migrations 260 et 390).
   */
  'admin.sanctions': {
    id: ColumnType<string, never, never>;
    user_id: ColumnType<string, string, never>;
    kind: ColumnType<
      'warning' | 'silence' | 'suspension' | 'ban',
      'warning' | 'silence' | 'suspension' | 'ban',
      never
    >;
    /** Début : l'écriture, ou la validation d'une exclusion. */
    starts_at: ColumnType<Date, never, never>;
    /** Nulle pour une exclusion, définitive, tant qu'elle n'est pas levée ; une levée y pose son instant. */
    ends_at: ColumnType<Date | null, Date | null, never>;
    reason: ColumnType<string, string, never>;
    author_id: ColumnType<string, string, never>;
    /** Seconde personne qui valide une exclusion : sans elle, l'exclusion n'est pas en vigueur. */
    validated_by: ColumnType<string | null, never, string>;
    appeal_body: ColumnType<string | null, never, string>;
    appealed_at: ColumnType<Date | null, never, never>;
    created_at: ColumnType<Date, never, never>;
    lifted_at: ColumnType<Date | null, never, never>;
    lifted_by: ColumnType<string | null, never, string>;
    appeal_decision: ColumnType<'granted' | 'rejected' | null, never, 'granted' | 'rejected'>;
    appeal_decided_by: ColumnType<string | null, never, string>;
    appeal_decided_at: ColumnType<Date | null, never, never>;
    /** Qui propose de lever une exclusion validée ; une autre personne la lève (double validation, 15.4). */
    lift_proposed_by: ColumnType<string | null, never, string>;
    lift_proposed_at: ColumnType<Date | null, never, never>;
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

/**
 * Nom de la contrainte violée (clé étrangère 23503, unicité 23505 ou vérification 23514), ou `null` pour toute
 * autre erreur. Une commande ne traduit que les contraintes qu'elle nomme (`errorByConstraint`).
 */
export function violatedConstraint(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const { code, constraint } = error as { code?: unknown; constraint?: unknown };
  const isViolation = code === '23503' || code === '23505' || code === '23514';
  return isViolation && typeof constraint === 'string' ? constraint : null;
}

/**
 * Code d'un conflit entre transactions, interblocage (40P01) ou échec de sérialisation (40001), ou `null` pour toute
 * autre erreur. PostgreSQL a alors annulé la transaction en entier : la rejouer ne double aucun effet (#333).
 */
export function transactionConflict(error: unknown): '40P01' | '40001' | null {
  if (typeof error !== 'object' || error === null) return null;
  const { code } = error as { code?: unknown };
  return code === '40P01' || code === '40001' ? code : null;
}

/** Un bien immobilier qui loge les travailleurs d'une maison, dans sa cité (4.5, #258). */
export interface HousingRow {
  houseId: string;
  cityId: string;
  sizeId: string;
  condition: number;
  upkeepUnpaid: boolean;
}

/**
 * Biens qui logent les travailleurs des maisons (4.5, #258) : ceux qu'une maison possède sans les avoir
 * loués, et ceux qu'elle loue par un bail en cours ; un bien loué loge son locataire, pas son propriétaire.
 * Un bien de la cité ne loge personne. Pour tout un monde, ou pour une seule maison. Les logements utiles
 * de chaque bien se comptent ensuite avec la configuration (`holdingUnits`, packages/sim).
 */
export async function readHousing(
  db: Db,
  scope: { worldId: string } | { houseId: string },
): Promise<HousingRow[]> {
  const rows = await db
    .selectFrom('game.properties as p')
    .leftJoin('game.leases as l', (join) =>
      join.onRef('l.property_id', '=', 'p.id').on('l.ended_at', 'is', null),
    )
    .select([
      sql<string>`coalesce(l.tenant_house_id, p.owner_house_id)`.as('house_id'),
      'p.city_id',
      'p.size_id',
      'p.condition',
      sql<boolean>`p.upkeep_unpaid_since is not null`.as('upkeep_unpaid'),
    ])
    .where('p.owner_house_id', 'is not', null)
    .where((where) =>
      'worldId' in scope
        ? where('p.world_id', '=', scope.worldId)
        : where(sql`coalesce(l.tenant_house_id, p.owner_house_id)`, '=', scope.houseId),
    )
    .orderBy('p.id')
    .execute();
  return rows.map((row) => ({
    houseId: row.house_id,
    cityId: row.city_id,
    sizeId: row.size_id,
    condition: row.condition,
    upkeepUnpaid: row.upkeep_unpaid,
  }));
}
