// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Ship } from '../icons';
import { IconButton } from './Button';
import { Field, TextField } from './Field';
import { Select } from './Select';

afterEach(cleanup);

/** Textes qui décrivent un élément, dans l'ordre de `aria-describedby`. */
const description = (element: HTMLElement) =>
  (element.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent);

describe('IconButton', () => {
  it('est nommé par son libellé, que l’infobulle reprend ; l’icône est décorative', () => {
    const onClick = vi.fn();
    render(<IconButton label="Fermer" icon={<Ship data-testid="icon" />} onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Fermer' });
    expect(button.getAttribute('title')).toBe('Fermer');
    expect(screen.getByTestId('icon').getAttribute('aria-hidden')).toBe('true');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('en chargement : même nom, inactif et occupé', () => {
    render(<IconButton label="Actualiser" icon={<Ship />} loading />);
    const button = screen.getByRole('button', { name: 'Actualiser' });
    expect(button).toHaveProperty('disabled', true);
    expect(button.getAttribute('aria-busy')).toBe('true');
  });
});

describe('TextField', () => {
  it('relie libellé, description de l’appelant, aide et erreur ; l’erreur le marque invalide', () => {
    render(
      <>
        <p id="extra">Unique dans la cité.</p>
        <TextField
          label="Nom"
          hint="3 à 30 lettres."
          error="Trop court."
          aria-describedby="extra"
        />
      </>,
    );
    const input = screen.getByRole('textbox', { name: 'Nom' });
    expect(description(input)).toEqual(['Unique dans la cité.', '3 à 30 lettres.', 'Trop court.']);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe('Trop court.');
  });

  it('sans erreur : valide, et la région d’erreur existe déjà, vide', () => {
    render(<Field label="Nom" />);
    const input = screen.getByRole('textbox', { name: 'Nom' });
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(input.hasAttribute('aria-describedby')).toBe(false);
    expect(screen.getByRole('alert').textContent).toBe('');
  });
});

describe('Select', () => {
  it('liste native nommée, reliée à son aide et à son erreur ; le choix remonte', () => {
    const onChange = vi.fn();
    render(
      <Select label="Port" hint="Port d’arrivée." error="Port fermé." onChange={onChange}>
        <option value="athens">Athènes</option>
        <option value="corinth">Corinthe</option>
      </Select>,
    );
    const select = screen.getByRole('combobox', { name: 'Port' });
    expect(description(select)).toEqual(['Port d’arrivée.', 'Port fermé.']);
    expect(select.getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(select, { target: { value: 'corinth' } });
    expect(onChange).toHaveBeenCalledOnce();
    expect((select as HTMLSelectElement).value).toBe('corinth');
  });

  it('libellé caché : toujours le nom de la liste, sans place au-dessus d’elle', () => {
    render(
      <Select label="Bien" hideLabel quiet>
        <option value="wheat">Blé</option>
      </Select>,
    );
    const label = screen.getByText('Bien');
    expect(screen.getByRole('combobox', { name: 'Bien' })).toBeTruthy();
    expect(label.className).toBe('sr-only');
  });
});
