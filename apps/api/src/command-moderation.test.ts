import { describe, expect, it } from 'vitest';
import { COMMANDS } from './app';

// Sanctions (#275) : qui une sanction refuse-t-elle ? Une commande nouvelle qui écrit du texte d'un joueur doit
// choisir son mode ; ce test, figé, le rappelle.
describe('modes de modération des commandes enregistrées', () => {
  const names = (keep: (command: (typeof COMMANDS)[number]) => boolean) =>
    COMMANDS.filter(keep)
      .map((command) => command.name)
      .sort();

  it('seules chat.post et les noms de maison sont refusés à un compte réduit au silence ; seuls l’appel et l’annulation d’un ordre sont exempts (#528)', () => {
    expect(names((command) => command.moderation === 'chat')).toEqual([
      'chat.post',
      'house.create',
      'house.rename',
    ]);
    expect(names((command) => command.moderation === 'exempt')).toEqual([
      'market.cancelOrder',
      'moderation.appeal',
    ]);
  });

  it('une commande d’administration ne déclare aucun mode : son rôle en décide', () => {
    expect(names((command) => !!command.admin && command.moderation !== undefined)).toEqual([]);
    expect(names((command) => !!command.admin).every((name) => name.startsWith('admin.'))).toBe(
      true,
    );
  });
});
