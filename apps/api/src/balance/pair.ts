/**
 * Les deux parties du simulateur (#284, #904), jouées en parallèle : chacune a son processus, son monde et sa graine, et
 * ne lit rien de l'autre, donc le rapport est celui des parties jouées l'une après l'autre. Si l'une échoue, l'autre est
 * attendue avant de lever (ses processus ne restent pas orphelins), avec la première erreur.
 */
export async function playPair<T>(games: {
  reference: () => Promise<T>;
  candidate: () => Promise<T>;
}): Promise<{ reference: T; candidate: T }> {
  const [reference, candidate] = await Promise.allSettled([
    (async () => games.reference())(),
    (async () => games.candidate())(),
  ]);
  if (reference.status === 'rejected') throw reference.reason;
  if (candidate.status === 'rejected') throw candidate.reason;
  return { reference: reference.value, candidate: candidate.value };
}
