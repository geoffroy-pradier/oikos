import { expect, it } from 'vitest';
import { WORKSPACE_NAME } from './index';

it('expose le nom de l’espace de travail', () => {
  expect(WORKSPACE_NAME).toBe('@oikos/ai');
});
