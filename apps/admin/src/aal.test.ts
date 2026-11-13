import { expect, it } from 'vitest';
import { assuranceLevel } from './aal';

const token = (claims: unknown) =>
  `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;

it('lit le niveau dans le jeton, y compris avec un contenu non ASCII', () => {
  expect(assuranceLevel(token({ aal: 'aal2', name: 'Kallistè ✓ ~~~???' }))).toBe('aal2');
  expect(assuranceLevel(token({ aal: 'aal1' }))).toBe('aal1');
});

it('tout jeton sans second facteur lisible vaut aal1', () => {
  for (const claims of [{}, { aal: 'aal3' }, { aal: true }, null, 'aal2', ['aal2']])
    expect(assuranceLevel(token(claims))).toBe('aal1');
  for (const broken of ['', 'aal2', 'a.b', 'a.%%%.c', `a.${btoa('{"aal":"aal2"')}.c`])
    expect(assuranceLevel(broken)).toBe('aal1');
});
