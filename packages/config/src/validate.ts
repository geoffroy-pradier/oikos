import { gameConfigSchema, type GameConfig } from './schema';

export type ConfigValidation =
  { ok: true; config: Readonly<GameConfig> } | { ok: false; errors: string[] };

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

function formatPath(path: PropertyKey[]): string {
  return path
    .map((part, index) =>
      typeof part === 'number' ? `[${part}]` : `${index ? '.' : ''}${String(part)}`,
    )
    .join('');
}

/**
 * Valide une configuration candidate. En cas de refus, chaque erreur nomme le chemin exact de la valeur
 * fautive (`goods[2].elasticity: …`). En cas de succès, la configuration rendue est figée.
 */
export function validateConfig(candidate: unknown): ConfigValidation {
  const parsed = gameConfigSchema.safeParse(candidate);
  if (parsed.success) return { ok: true, config: deepFreeze(parsed.data) };
  return {
    ok: false,
    errors: parsed.error.issues.map(
      (issue) => `${formatPath(issue.path) || '(root)'}: ${issue.message}`,
    ),
  };
}
