import { expect, it, vi } from 'vitest';
import { sendCommand } from './api';

const respond = (body: unknown, status = 200) =>
  vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));

it('envoie la commande avec le jeton et rend la réponse de l’API', async () => {
  const fetchImpl = respond({ ok: true, data: { houseId: 'h1' } });
  const result = await sendCommand('house.create', { name: 'Abc' }, 'token-1', fetchImpl);
  expect(result).toEqual({ ok: true, data: { houseId: 'h1' } });
  const [url, init] = fetchImpl.mock.calls[0] ?? [];
  expect(url).toBe('/api/commands/house.create');
  expect(new Headers(init?.headers).get('authorization')).toBe('Bearer token-1');
  expect(init?.body).toBe('{"name":"Abc"}');
});

it('transmet une erreur métier telle quelle', async () => {
  const error = { code: 'HOUSE_NAME_TAKEN', message: 'taken' };
  expect(await sendCommand('house.create', {}, 't', respond({ ok: false, error }, 409))).toEqual({
    ok: false,
    error,
  });
});

it('ramène une panne réseau ou une réponse illisible à INTERNAL', async () => {
  const down = vi.fn<typeof fetch>(async () => Promise.reject(new TypeError('offline')));
  expect(await sendCommand('x', {}, 't', down)).toMatchObject({ error: { code: 'INTERNAL' } });
  const html = vi.fn<typeof fetch>(async () => new Response('<html>502</html>', { status: 502 }));
  expect(await sendCommand('x', {}, 't', html)).toMatchObject({ error: { code: 'INTERNAL' } });
});

it('ramène une enveloppe mal formée à INTERNAL', async () => {
  for (const body of [
    { ok: false },
    { ok: 'yes', data: {} },
    { ok: true },
    { ok: false, error: 'x' },
    null,
  ]) {
    expect(await sendCommand('x', {}, 't', respond(body))).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL' },
    });
  }
});
