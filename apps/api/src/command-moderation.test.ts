import { describe, expect, it } from 'vitest';
import { COMMANDS } from './app';

// Sanctions (#275) : qui une sanction refuse-t-elle ? Une commande nouvelle qui écrit du texte d'un joueur doit
// choisir son mode ; ce test, figé, le rappelle.
describe('modes de modération des commandes enregistrées', () => {
  const names = (keep: (command: (typeof COMMANDS)[number]) => boolean) =>
    COMMANDS.filter(keep)
      .map((command) => command.name)
      .sort();

  it('seule chat.post est refusée à un compte réduit au silence ; seul l’appel est exempt', () => {
    expect(names((command) => command.moderation === 'chat')).toEqual(['chat.post']);
    expect(names((command) => command.moderation === 'exempt')).toEqual(['moderation.appeal']);
  });

  it('une commande d’administration ne déclare aucun mode : son rôle en décide', () => {
    expect(names((command) => !!command.admin && command.moderation !== undefined)).toEqual([]);
    expect(names((command) => !!command.admin).every((name) => name.startsWith('admin.'))).toBe(
      true,
    );
  });
});
