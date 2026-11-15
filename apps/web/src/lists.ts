/** Énumération dans la langue de l'écran : « 80 × Blé et 16 × Farine », « wheat, flour, and salt ». */
export function formatList(language: string, items: readonly string[]): string {
  return new Intl.ListFormat(language, { style: 'long', type: 'conjunction' }).format(items);
}
