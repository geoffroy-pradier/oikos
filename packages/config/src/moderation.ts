/**
 * Filtre de vocabulaire de la discussion (docs/specs/06-cites-politique-communaute.md, 6.6 ; #275) : un message
 * qui contient un terme interdit de la configuration (`moderation.bannedTerms`) est refusé avant tout
 * enregistrement. La comparaison ignore la casse et les accents, et se fait mot à mot : un terme interdit
 * n'est reconnu que là où il forme un ou plusieurs mots entiers (« con » ne refuse pas « conseil »).
 */

/** Caractères de format (espace sans largeur, trait d'union conditionnel…) : retirés, ils ne séparent rien. */
const FORMAT = /\p{Cf}/gu;
/** Marques combinantes (accents, après décomposition) : retirées. */
const MARKS = /\p{M}/gu;
/** Tout ce qui n'est ni lettre ni chiffre sépare deux mots. */
const SEPARATORS = /[^\p{L}\p{N}]+/gu;

/**
 * Forme comparée d'un texte : décomposé (NFKD : les formes de compatibilité, comme les lettres pleine chasse ou
 * mathématiques, rejoignent leur lettre), puis en minuscules, décomposé de nouveau (une minuscule peut l'être),
 * sans accent ni caractère de format, le sigma final ramené au sigma, ses mots séparés d'une espace. Vide pour un
 * texte sans lettre ni chiffre.
 */
export function filterForm(text: string): string {
  return text
    .normalize('NFKD')
    .toLowerCase()
    .normalize('NFKD')
    .replace(FORMAT, '')
    .replace(MARKS, '')
    .replaceAll('ς', 'σ')
    .replace(SEPARATORS, ' ')
    .trim();
}

/**
 * Premier terme interdit que contient le texte, tel qu'il est écrit dans la configuration, ou `null`. Un terme de
 * plusieurs mots est reconnu quand ces mots se suivent dans le texte, quels que soient leurs séparateurs.
 */
export function findBannedTerm(terms: readonly string[], text: string): string | null {
  const words = ` ${filterForm(text)} `;
  for (const term of terms) {
    const form = filterForm(term);
    if (form !== '' && words.includes(` ${form} `)) return term;
  }
  return null;
}
