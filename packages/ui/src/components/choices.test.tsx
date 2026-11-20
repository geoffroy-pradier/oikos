// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SegmentedControl } from './SegmentedControl';
import { Switch } from './Switch';
import { PillTabs } from './Tabs';

afterEach(cleanup);

describe('PillTabs', () => {
  it('sans panneau : la liste seule, sans lien vers un panneau absent', () => {
    const onValueChange = vi.fn();
    const items = ['ventes', 'achats'].map((id) => ({ id, label: id }));
    render(<PillTabs label="Agora" items={items} onValueChange={onValueChange} />);
    const [first, second] = screen.getAllByRole('tab');
    expect(first?.hasAttribute('aria-controls')).toBe(false);
    expect(screen.queryByRole('tabpanel')).toBeNull();
    fireEvent.keyDown(first as HTMLElement, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(second);
    expect(second?.getAttribute('aria-selected')).toBe('true');
    expect(onValueChange).toHaveBeenCalledWith('achats');
  });

  it('panneaux gardés montés : l’onglet quitté garde sa saisie, caché', () => {
    const items = ['ventes', 'achats'].map((id) => ({
      id,
      label: id,
      content: <input aria-label={`champ ${id}`} />,
    }));
    render(<PillTabs label="Agora" items={items} keepMounted />);
    const field = screen.getByLabelText('champ ventes') as HTMLInputElement;
    fireEvent.change(field, { target: { value: '12' } });
    fireEvent.click(screen.getByRole('tab', { name: 'achats' }));
    expect(field.closest('[role="tabpanel"]')?.hasAttribute('hidden')).toBe(true);
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    fireEvent.click(screen.getByRole('tab', { name: 'ventes' }));
    expect((screen.getByLabelText('champ ventes') as HTMLInputElement).value).toBe('12');
  });
});

describe('SegmentedControl', () => {
  const options = ['sell', 'buy', 'hold'].map((value) => ({ value, label: `Opt ${value}` }));

  it('groupe de boutons radio nommé, un seul arrêt de tabulation', () => {
    render(<SegmentedControl label="Sens" options={options} defaultValue="buy" />);
    expect(screen.getByRole('radiogroup', { name: 'Sens' })).toBeTruthy();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    expect(radios.map((radio) => radio.tabIndex)).toEqual([-1, 0, -1]);
  });

  it('les quatre flèches, Début et Fin déplacent le choix et le foyer, en boucle', () => {
    const onValueChange = vi.fn();
    render(<SegmentedControl label="Sens" options={options} onValueChange={onValueChange} />);
    const [first, , last] = screen.getAllByRole('radio');
    fireEvent.keyDown(first as HTMLElement, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last as HTMLElement, { key: 'ArrowDown' });
    fireEvent.keyDown(first as HTMLElement, { key: 'ArrowRight' });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowLeft' });
    fireEvent.keyDown(first as HTMLElement, { key: 'End' });
    fireEvent.keyDown(last as HTMLElement, { key: 'Home' });
    fireEvent.keyDown(first as HTMLElement, { key: 'a' });
    expect(onValueChange.mock.calls.map(([value]) => value)).toEqual([
      'hold',
      'sell',
      'buy',
      'sell',
      'hold',
      'sell',
    ]);
  });

  it('inactif, il ne change pas ; tenu par le parent, il suit sa valeur', () => {
    const onValueChange = vi.fn();
    const props = { label: 'Sens', options, onValueChange };
    const { rerender } = render(<SegmentedControl {...props} defaultValue="sell" disabled />);
    fireEvent.click(screen.getByRole('radio', { name: 'Opt buy' }));
    expect(onValueChange).not.toHaveBeenCalled();
    rerender(<SegmentedControl {...props} value="hold" />);
    const checked = screen.getAllByRole('radio', { checked: true });
    expect(checked.map((radio) => radio.textContent)).toEqual(['Opt hold']);
  });

  it('valeur hors des options : aucun choix, la première reste atteignable au clavier', () => {
    render(<SegmentedControl label="Sens" options={options} value="lend" />);
    const radios = screen.getAllByRole('radio');
    expect(radios.map((radio) => radio.tabIndex)).toEqual([0, -1, -1]);
    expect(screen.queryAllByRole('radio', { checked: true })).toHaveLength(0);
  });
});

describe('Switch', () => {
  it('nommé par son libellé, décrit par son aide ; un clic sur le libellé le bascule', () => {
    const onCheckedChange = vi.fn();
    render(
      <Switch
        label="Avis par courriel"
        hint="Ordres exécutés."
        onCheckedChange={onCheckedChange}
      />,
    );
    const toggle = screen.getByRole('switch', { name: 'Avis par courriel' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(
      document.getElementById(toggle.getAttribute('aria-describedby') ?? '')?.textContent,
    ).toBe('Ordres exécutés.');
    fireEvent.click(screen.getByText('Avis par courriel'));
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(onCheckedChange.mock.calls).toEqual([[true], [false]]);
  });

  it('tenu par le parent, il ne change pas seul ; inactif, il ne bascule pas', () => {
    const onCheckedChange = vi.fn();
    const { rerender } = render(<Switch label="Vente" checked onCheckedChange={onCheckedChange} />);
    const toggle = screen.getByRole('switch', { name: 'Vente' });
    fireEvent.click(toggle);
    expect(onCheckedChange).toHaveBeenCalledWith(false);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    rerender(<Switch label="Vente" checked={false} disabled onCheckedChange={onCheckedChange} />);
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(onCheckedChange).toHaveBeenCalledOnce();
  });

  it('compose la description et le clic de l’appelant, qui peut empêcher la bascule', () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <>
        <p id="extra">Une fois par jour.</p>
        <Switch label="Avis" hint="Ordres exécutés." aria-describedby="extra" onClick={onClick} />
      </>,
    );
    const toggle = screen.getByRole('switch', { name: 'Avis' });
    const ids = (toggle.getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids.map((id) => document.getElementById(id)?.textContent)).toEqual([
      'Une fois par jour.',
      'Ordres exécutés.',
    ]);
    fireEvent.click(toggle);
    expect(onClick).toHaveBeenCalledOnce();
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    rerender(
      <>
        <p id="extra">Une fois par jour.</p>
        <Switch label="Avis" onClick={(event) => event.preventDefault()} />
      </>,
    );
    expect(screen.getByRole('switch', { name: 'Avis' })).toBe(toggle);
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });
});
