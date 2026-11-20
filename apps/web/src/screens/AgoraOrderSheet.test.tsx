// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { useState } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fr from '../locales/fr.json';
import { AgoraOrderSheet, type AgoraOrderSheetProps, type Side } from './AgoraOrderSheet';

const CITY = '11111111-1111-4111-8111-111111111111';
const TAX = { rateBps: 500, burnShareBps: 5000 };
afterEach(cleanup);

/** La feuille et deux boutons pour l'ouvrir, comme sur l'écran. */
function Harness(props: Partial<AgoraOrderSheetProps>) {
  const [side, setSide] = useState<Side | null>(null);
  return (
    <>
      <button onClick={() => setSide('sell')}>Ouvrir la vente</button>
      <button onClick={() => setSide('buy')}>Ouvrir l’achat</button>
      <AgoraOrderSheet
        side={side}
        onClose={() => setSide(null)}
        cityId={CITY}
        cityName="Kallistè"
        goodId="wheat"
        tax={TAX}
        free={80}
        cash={600}
        best={{ price: 19, quantity: 30 }}
        onPlace={() => Promise.resolve(null)}
        {...props}
      />
    </>
  );
}

async function show(props: Partial<AgoraOrderSheetProps> = {}) {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr } },
    lng: 'fr',
    interpolation: { escapeValue: false },
  });
  render(
    <I18nextProvider i18n={instance}>
      <Harness {...props} />
    </I18nextProvider>,
  );
}
const quantity = () => screen.getByLabelText('Quantité', { exact: true }) as HTMLInputElement;
const price = () => screen.getByLabelText('Prix limite par unité (oboles)') as HTMLInputElement;
const type = (field: HTMLInputElement, value: string) =>
  fireEvent.change(field, { target: { value } });
const alert = () =>
  screen
    .getAllByRole('alert')
    .map((region) => region.textContent)
    .join('');

describe('feuille de vente', () => {
  it('raccourcis bornés par le stock libre, meilleure offre en un clic, récapitulatif chiffré', async () => {
    const onPlace = vi.fn().mockResolvedValue(null);
    await show({ onPlace });
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir la vente' }));
    expect(screen.getByRole('dialog', { name: 'Vendre : Blé' })).toBeTruthy();
    expect(document.activeElement).toBe(quantity());
    expect(screen.getByText('Stock libre à Kallistè : 80 × Blé.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^50\s%$/ }));
    expect(quantity().value).toBe('40');
    fireEvent.click(screen.getByRole('button', { name: 'Tout' }));
    expect(quantity().value).toBe('80');
    expect(
      screen.getByText('Vendu tout de suite : des acheteurs attendent 30 × Blé à 19 oboles.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Choisir 19 oboles' }));
    expect(price().value).toBe('19');
    // Brut 1 520, taxe ⌈1 520 × 5 %⌉ = 76 : le net, annoncé en lisant les champs et le bouton.
    expect(quantity().getAttribute('aria-describedby')).toContain('expected-net');
    expect(document.getElementById('expected-net')?.textContent).toMatch(
      /^Net attendu : 240 drachmes 4 oboles \(253 drachmes 2 oboles moins 12 drachmes 4 oboles/,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    expect(screen.getByText("Vente de 80 × Blé, à 19 oboles l'unité au moins.")).toBeTruthy();
    const recap = Object.fromEntries(
      [...document.querySelectorAll('dl div')].map((row) => [
        row.querySelector('dt')?.textContent,
        row.querySelector('dd')?.textContent,
      ]),
    );
    expect(recap).toEqual({
      'Montant brut': '253 drachmes 2 oboles',
      'Taxe de marché': '12 drachmes 4 oboles',
      'Net reçu': '240 drachmes 4 oboles',
    });
    const submit = screen.getByRole('button', { name: "Déposer l'ordre" });
    expect(submit.getAttribute('aria-describedby')).toBe('expected-net');
    fireEvent.click(submit);
    await waitFor(() => expect(onPlace).toHaveBeenCalledTimes(1));
    expect(onPlace.mock.calls[0]?.[0]).toEqual({
      cityId: CITY,
      goodId: 'wheat',
      side: 'sell',
      price: 19,
      quantity: 80,
    });
  });

  it('refuse une saisie illisible ou au-delà du stock libre, sans rien envoyer', async () => {
    const onPlace = vi.fn();
    await show({ onPlace });
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir la vente' }));
    type(quantity(), 'beaucoup');
    type(price(), '2');
    fireEvent.keyDown(price(), { key: 'Enter' });
    expect(alert()).toBe('Certaines valeurs ne sont pas valides. Vérifiez votre saisie.');
    type(quantity(), '81');
    expect(alert()).toBe('');
    fireEvent.keyDown(quantity(), { key: 'Enter' });
    expect(alert()).toBe('Stock libre insuffisant : 80 × Blé seulement à Kallistè.');
    expect(screen.getByText('Au plus 80.')).toBeTruthy();
    expect(onPlace).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: "Déposer l'ordre" })).toBeNull();
  });

  it('sans achat en attente, rien n’est proposé ; la taxe inconnue n’annonce pas de net', async () => {
    await show({ best: null, tax: null });
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir la vente' }));
    expect(screen.getByText('Aucun achat en attente.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Choisir/ })).toBeNull();
    type(quantity(), '10');
    type(price(), '30');
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    expect(screen.getByText('Montant brut')).toBeTruthy();
    expect(screen.queryByText('Net reçu')).toBeNull();
  });
});

describe('feuille d’achat', () => {
  it('raccourcis bornés par la trésorerie au prix saisi, coût et séquestre au récapitulatif', async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir l’achat' }));
    expect(screen.getByRole('dialog', { name: 'Acheter : Blé' })).toBeTruthy();
    expect(screen.getByText('Trésorerie : 100 drachmes.')).toBeTruthy();
    // Sans prix, pas de borne ; à 19 oboles, 600 oboles paient 31 unités.
    expect(screen.queryByRole('button', { name: 'Tout' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Choisir 19 oboles' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tout' }));
    expect(quantity().value).toBe('31');
    // Un achat ne paie pas la taxe : rien n'est annoncé ; au-delà de la trésorerie, il reste permis.
    expect(quantity().getAttribute('aria-describedby')).toBeNull();
    type(quantity(), '40');
    expect(quantity().getAttribute('aria-invalid')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    expect(screen.getByText('Coût au plus')).toBeTruthy();
    expect(screen.getByText("jusqu'à 126 drachmes 4 oboles")).toBeTruthy();
    expect(screen.queryByText('Taxe de marché')).toBeNull();
  });

  it('un refus reste dans la feuille, la saisie se renvoie telle quelle et survit à la fermeture', async () => {
    const onPlace = vi
      .fn()
      .mockResolvedValueOnce('Une erreur est survenue. Réessayez dans un instant.')
      .mockResolvedValueOnce(null);
    await show({ onPlace });
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir l’achat' }));
    type(quantity(), '5');
    type(price(), '12');
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    fireEvent.click(screen.getByRole('button', { name: "Déposer l'ordre" }));
    await waitFor(() =>
      expect(alert()).toBe('Une erreur est survenue. Réessayez dans un instant.'),
    );
    // Fermée puis rouverte, la feuille garde la saisie : le même ordre repart.
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir l’achat' }));
    expect(quantity().value).toBe('5');
    expect(price().value).toBe('12');
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    fireEvent.click(screen.getByRole('button', { name: "Déposer l'ordre" }));
    await waitFor(() => expect(onPlace).toHaveBeenCalledTimes(2));
    expect(onPlace.mock.calls[1]?.[0]).toEqual(onPlace.mock.calls[0]?.[0]);
    // La vente, elle, ne reprend pas la saisie de l'achat.
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir la vente' }));
    expect(quantity().value).toBe('');
  });
});
