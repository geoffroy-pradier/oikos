// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { tabOf } from './tabs';

describe('onglet actif', () => {
  it('marque l’onglet de chaque racine', () => {
    expect(['/', '/carte', '/agora', '/cite', '/messages'].map(tabOf)).toEqual([
      'house',
      'map',
      'agora',
      'city',
      'messages',
    ]);
  });

  it('garde l’onglet Maison sur ses écrans, même avec une barre finale', () => {
    expect(tabOf('/comptes')).toBe('house');
    expect(tabOf('/comptes/')).toBe('house');
    expect(tabOf('/agora/')).toBe('agora');
  });

  it('ne marque aucun onglet pour une page inconnue', () => {
    expect(tabOf('/inconnu')).toBeNull();
    expect(tabOf('/comptesx')).toBeNull();
  });
});
