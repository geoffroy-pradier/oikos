import { afterEach, expect } from 'vitest';

/**
 * Garde des tests d'intégration de l'API (#333), chargée avant chaque fichier (`vitest.config.ts`). Le registre rejoue
 * en silence une commande que la base annule sur un conflit entre transactions : sans cette garde, un test « sans
 * interblocage » passerait encore avec un cycle de verrous. Tout avertissement de conflit du registre (« transaction
 * conflict ») fait échouer le test en cours, sauf s'il l'accepte par `acceptTransactionConflicts()`.
 */
interface Guard {
  seen: string[];
  accepted: boolean;
}
const shared = globalThis as { oikosConflictGuard?: Guard };
const guard = (shared.oikosConflictGuard ??= { seen: [], accepted: false });
type Warn = typeof console.warn & { conflictGuard?: true };
if (!(console.warn as Warn).conflictGuard) {
  const warn = console.warn.bind(console);
  console.warn = Object.assign(
    (...args: unknown[]) => {
      if (String(args[0]).includes('transaction conflict')) guard.seen.push(String(args[0]));
      else warn(...args);
    },
    { conflictGuard: true as const },
  );
}
afterEach(() => {
  const [seen, accepted] = [guard.seen.splice(0), guard.accepted];
  guard.accepted = false;
  if (!accepted) expect(seen, 'conflit entre transactions inattendu (#333)').toEqual([]);
});

/** Le test en cours accepte les conflits ; rend le nombre de conflits vus portant ce code, depuis son début. */
export function acceptTransactionConflicts() {
  guard.accepted = true;
  return (code: string) => guard.seen.filter((text) => text.includes(code)).length;
}
