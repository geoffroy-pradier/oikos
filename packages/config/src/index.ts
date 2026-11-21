/** Schémas et valeurs d'équilibrage. Aucune constante d'équilibrage ne vit ailleurs que dans ce paquet. */
import initial from './values/initial.json' with { type: 'json' };

export * from './banks';
export * from './decrees';
export * from './graces';
export * from './honor';
export * from './hubris';
export * from './liturgies';
export * from './moderation';
export * from './npc-houses';
export * from './oracle';
export * from './schema';
export * from './stewards';
export * from './store';
export * from './temple-treasury';
export * from './validate';
export * from './world-events';

/** Jeu de valeurs initial (phase 1 : une cité, 15 biens). À valider par `validateConfig` avant usage. */
export const INITIAL_CONFIG: unknown = initial;
