// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { LanguageSelect } from './LanguageSelect';

afterEach(cleanup);

describe('LanguageSelect', () => {
  function Header() {
    const [language, setLanguage] = useState('fr');
    return (
      <LanguageSelect
        languages={['fr', 'en']}
        value={language}
        onChange={setLanguage}
        label="Langue"
        nameOf={(code) => ({ fr: 'Français', en: 'English' })[code] ?? code}
      />
    );
  }

  it('liste nommée par son libellé, chaque langue dans sa langue ; le choix est rendu à l’appelant', () => {
    render(<Header />);
    const select = screen.getByLabelText('Langue') as HTMLSelectElement;
    expect(
      [...select.options].map((option) => [option.value, option.lang, option.textContent]),
    ).toEqual([
      ['fr', 'fr', 'Français'],
      ['en', 'en', 'English'],
    ]);
    fireEvent.change(select, { target: { value: 'en' } });
    expect(select.value).toBe('en');
    // Les icônes sont décoratives : le nom de la liste reste « Langue ».
    for (const icon of document.querySelectorAll('svg'))
      expect(icon.getAttribute('aria-hidden')).toBe('true');
  });

  it('en version compacte, sans l’icône des langues', () => {
    const props = { languages: ['fr'], value: 'fr', onChange: () => {}, label: 'Langue' };
    const { container, rerender } = render(<LanguageSelect {...props} nameOf={(c) => c} />);
    expect(container.querySelectorAll('svg')).toHaveLength(2);
    rerender(<LanguageSelect {...props} nameOf={(c) => c} compact />);
    expect(container.querySelectorAll('svg')).toHaveLength(1);
  });
});
