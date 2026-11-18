import { describe, expect, it } from 'vitest';
import { filterForm, findBannedTerm } from './moderation';

describe('filtre de vocabulaire', () => {
  const terms = ['Maudit', 'fils de chien', 'Ἀσεβής'];

  it('ignore la casse, les accents, les formes de compatibilité et les caractères de format', () => {
    for (const text of [
      'maudit',
      'Tu es MAUDIT !',
      'mâudît soit-il',
      'ｍａｕｄｉｔ',
      'mau­dit',
      'mau​dit',
      'Máudit',
      'asebhs ἀσεβής',
      '𝐌𝐀𝐔𝐃𝐈𝐓',
      'ℳaudit',
      'MAUDİT',
    ])
      expect([text, findBannedTerm(terms, text)]).toEqual([text, expect.any(String)]);
  });

  it('rend le terme tel que la configuration l’écrit', () => {
    expect(findBannedTerm(terms, '… MAUDIT …')).toBe('Maudit');
    expect(findBannedTerm(terms, 'ασεβης')).toBe('Ἀσεβής');
    // Sigma final ou non, en minuscule comme en majuscule : la même lettre.
    for (const text of ['ασεβησ', 'ΑΣΕΒΗΣ', 'ἈΣΕΒΉΣ !'])
      expect([text, findBannedTerm(terms, text)]).toEqual([text, 'Ἀσεβής']);
    expect(findBannedTerm(['ασεβησ'], 'ασεβης')).toBe('ασεβησ');
  });

  it('ne reconnaît un terme que s’il forme des mots entiers, quels que soient leurs séparateurs', () => {
    expect(findBannedTerm(terms, 'Fils-de—chien !')).toBe('fils de chien');
    expect(findBannedTerm(terms, "l'maudit")).toBe('Maudit');
    expect(findBannedTerm(terms, 'maudits')).toBeNull();
    expect(findBannedTerm(terms, 'immaudit')).toBeNull();
    expect(findBannedTerm(terms, 'fils de chienne')).toBeNull();
    expect(findBannedTerm(terms, 'fils, chien')).toBeNull();
    expect(findBannedTerm(terms, 'Bonjour, Kallistè.')).toBeNull();
  });

  it('une liste vide ne refuse rien ; un terme sans lettre ni chiffre non plus', () => {
    expect(findBannedTerm([], 'maudit')).toBeNull();
    expect(findBannedTerm(['--', ' '], '-- --')).toBeNull();
  });

  it('forme comparée : minuscules, sans accent, mots séparés d’une espace', () => {
    expect(filterForm('  Ça, c’est ÉTÉ !\n\tΟὐ ')).toBe('ca c est ete ου');
    expect(filterForm('𝐌𝐀𝐔𝐃𝐈𝐓 ℳ')).toBe('maudit m');
    expect(filterForm('?!')).toBe('');
  });
});
