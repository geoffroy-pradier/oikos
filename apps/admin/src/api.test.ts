import { expect, it, vi } from 'vitest';
import { adminCommand, adminGet } from './api';

const respond = (body: unknown, status = 200) =>
  vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));

it('lit une route d’administration avec le jeton de la session', async () => {
  const fetchImpl = respond({ ok: true, data: { role: 'observer' } });
  expect(await adminGet('me', 'jeton-1', fetchImpl)).toEqual({
    ok: true,
    data: { role: 'observer' },
  });
  const [url, init] = fetchImpl.mock.calls[0] ?? [];
  expect(url).toBe('/api/admin/me');
  expect(new Headers(init?.headers).get('authorization')).toBe('Bearer jeton-1');
});

it('rend le code du refus de l’API', async () => {
  const fetchImpl = respond({ ok: false, error: { code: 'FORBIDDEN', message: 'no' } }, 403);
  expect(await adminGet('vigie', 'jeton', fetchImpl)).toEqual({ ok: false, code: 'FORBIDDEN' });
});

it('ne lève jamais : panne réseau ou réponse illisible deviennent INTERNAL', async () => {
  const down = vi.fn<typeof fetch>(async () => Promise.reject(new Error('réseau coupé')));
  expect(await adminGet('vigie', 'jeton', down)).toEqual({ ok: false, code: 'INTERNAL' });
  const html = vi.fn<typeof fetch>(async () => new Response('<html>', { status: 502 }));
  expect(await adminGet('vigie', 'jeton', html)).toEqual({ ok: false, code: 'INTERNAL' });
  expect(await adminGet('vigie', 'jeton', respond({ ok: true }))).toEqual({
    ok: false,
    code: 'INTERNAL',
  });
});

it('envoie une commande avec jeton, clé d’idempotence et entrée, et rend les champs refusés', async () => {
  const fetchImpl = respond({ ok: true, data: { number: 4 } });
  expect(
    await adminCommand('admin.publishConfig', { note: 'n' }, 'jeton-1', 'cle-1', fetchImpl),
  ).toEqual({ ok: true, data: { number: 4 } });
  const [url, init] = fetchImpl.mock.calls[0] ?? [];
  expect(url).toBe('/api/commands/admin.publishConfig');
  expect(init?.method).toBe('POST');
  const headers = new Headers(init?.headers);
  expect(headers.get('authorization')).toBe('Bearer jeton-1');
  expect(headers.get('idempotency-key')).toBe('cle-1');
  expect(init?.body).toBe('{"note":"n"}');

  const refused = respond(
    { ok: false, error: { code: 'CONFIG_INVALID', message: 'no', fields: ['market.x'] } },
    422,
  );
  expect(await adminCommand('admin.publishConfig', {}, 'jeton', 'cle', refused)).toEqual({
    ok: false,
    code: 'CONFIG_INVALID',
    fields: ['market.x'],
  });
  const down = vi.fn<typeof fetch>(async () => Promise.reject(new Error('réseau coupé')));
  expect(await adminCommand('admin.publishConfig', {}, 'jeton', 'cle', down)).toEqual({
    ok: false,
    code: 'INTERNAL',
  });
});
