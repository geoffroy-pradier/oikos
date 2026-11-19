// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NumberField, type NumberFieldProps } from './NumberField';

afterEach(cleanup);

const LABELS = { decrement: 'Moins', increment: 'Plus', all: 'Tout', shortcuts: 'Raccourcis' };
const fr = (n: number) => new Intl.NumberFormat('fr').format(n);

function setup(props: Partial<NumberFieldProps> = {}) {
  const onValueChange = vi.fn();
  const view = render(
    <NumberField
      label="Quantité"
      locale="fr"
      labels={LABELS}
      onValueChange={onValueChange}
      {...props}
    />,
  );
  const input = screen.getByRole('spinbutton', { name: 'Quantité' }) as HTMLInputElement;
  return { input, onValueChange, ...view };
}

describe('NumberField', () => {
  it('montre la valeur au format de la langue, avec ses bornes', () => {
    const { input } = setup({ defaultValue: 12_500, min: 0, max: 20_000 });
    expect(input.value).toBe(fr(12_500));
    expect(input.getAttribute('aria-valuenow')).toBe('12500');
    expect(input.getAttribute('aria-valuetext')).toBe(fr(12_500));
    expect(input.getAttribute('aria-valuemin')).toBe('0');
    expect(input.getAttribute('aria-valuemax')).toBe('20000');
  });

  it('↑/↓ font un pas, Page haut/bas dix, sans passer les bornes', () => {
    const { input, onValueChange } = setup({ defaultValue: 5, min: 0, max: 30 });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'PageUp' });
    expect(input.value).toBe('16');
    fireEvent.keyDown(input, { key: 'PageUp' });
    fireEvent.keyDown(input, { key: 'PageUp' });
    expect(input.value).toBe('30');
    fireEvent.keyDown(input, { key: 'PageDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(onValueChange.mock.calls.map(([value]) => value)).toEqual([6, 16, 26, 30, 20, 19]);
  });

  it('les boutons ± sont nommés, hors de la tabulation, et inactifs à la borne', () => {
    const { input } = setup({ defaultValue: 1, min: 0, max: 2 });
    const minus = screen.getByRole('button', { name: 'Moins' });
    const plus = screen.getByRole('button', { name: 'Plus' });
    expect(minus.tabIndex).toBe(-1);
    fireEvent.click(plus);
    expect(input.value).toBe('2');
    expect(plus).toHaveProperty('disabled', true);
    fireEvent.click(minus);
    fireEvent.click(minus);
    expect(input.value).toBe('0');
    expect(minus).toHaveProperty('disabled', true);
  });

  it('lit la saisie à chaque frappe, au format de la langue, et la remet en forme en sortant', () => {
    const { input, onValueChange } = setup();
    fireEvent.change(input, { target: { value: '1 250' } });
    expect(onValueChange).toHaveBeenLastCalledWith(1_250);
    fireEvent.change(input, { target: { value: '1250' } });
    fireEvent.blur(input);
    expect(input.value).toBe(fr(1_250));
    fireEvent.change(input, { target: { value: '' } });
    expect(onValueChange).toHaveBeenLastCalledWith(null);
  });

  it('lit l’anglais avec sa virgule des milliers', () => {
    const { input, onValueChange } = setup({ locale: 'en' });
    fireEvent.change(input, { target: { value: '1,250' } });
    expect(onValueChange).toHaveBeenLastCalledWith(1_250);
  });

  it('dit le problème à la saisie, relié au champ ; l’erreur du parent l’emporte', () => {
    const messages = { unreadable: 'Illisible.', aboveMax: 'Au plus 10.', notInteger: 'Entier.' };
    const { input, rerender } = setup({ max: 10, messages });
    const alert = screen.getByRole('alert');
    for (const [typed, message] of [
      ['abc', 'Illisible.'],
      ['12', 'Au plus 10.'],
      ['2,5', 'Entier.'],
    ]) {
      fireEvent.change(input, { target: { value: typed } });
      expect(alert.textContent).toBe(message);
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(input.getAttribute('aria-describedby')).toBe(alert.id);
    }
    fireEvent.change(input, { target: { value: '7' } });
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    rerender(
      <NumberField label="Quantité" locale="fr" labels={LABELS} max={10} error="Stock vide." />,
    );
    expect(alert.textContent).toBe('Stock vide.');
  });

  it('raccourcis 25 %, 50 % et tout quand la borne est connue, arrondis au pas', () => {
    const { input } = setup({ max: 1_000, step: 3 });
    const group = screen.getByRole('group', { name: 'Raccourcis' });
    const pct = new Intl.NumberFormat('fr', { style: 'percent' });
    fireEvent.click(screen.getByRole('button', { name: pct.format(0.25) }));
    expect(input.value).toBe('249');
    fireEvent.click(screen.getByRole('button', { name: pct.format(0.5) }));
    expect(input.value).toBe('498');
    fireEvent.click(screen.getByRole('button', { name: 'Tout' }));
    expect(input.value).toBe(fr(1_000));
    expect(group.querySelectorAll('button')).toHaveLength(3);
  });

  it('sans borne haute, ni raccourcis ; tenu par le parent, il suit sa valeur', () => {
    const { input, rerender } = setup({ value: 3 });
    expect(screen.queryByRole('group')).toBeNull();
    rerender(<NumberField label="Quantité" locale="fr" labels={LABELS} value={4_000} />);
    expect(input.value).toBe(fr(4_000));
  });
});
