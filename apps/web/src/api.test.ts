import { expect, it, vi } from 'vitest';
import { consultOracle, invokeGrace, makeOffering, sendCommand } from './api';

const respond = (body: unknown, status = 200) =>
  vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));

it('envoie la commande avec le jeton et rend la réponse de l’API', async () => {
  const fetchImpl = respond({ ok: true, data: { houseId: 'h1' } });
  const result = await sendCommand(
    'house.create',
    { name: 'Abc' },
    'token-1',
    'key-12345678',
    fetchImpl,
  );
  expect(result).toEqual({ ok: true, data: { houseId: 'h1' }, replayed: false });
  const [url, init] = fetchImpl.mock.calls[0] ?? [];
  expect(url).toBe('/api/commands/house.create');
  expect(new Headers(init?.headers).get('authorization')).toBe('Bearer token-1');
  expect(new Headers(init?.headers).get('Idempotency-Key')).toBe('key-12345678');
  expect(init?.body).toBe('{"name":"Abc"}');
});

it('signale une commande rejouée sous la même clé', async () => {
  const fetchImpl = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify({ ok: true, data: { siteId: 's1' } }), {
        headers: { 'Idempotent-Replay': 'true' },
      }),
  );
  const result = await sendCommand('site.acquire', {}, 'token-1', 'key-12345678', fetchImpl);
  expect(result).toEqual({ ok: true, data: { siteId: 's1' }, replayed: true });
});

it('transmet une erreur métier telle quelle', async () => {
  const error = { code: 'HOUSE_NAME_TAKEN', message: 'taken' };
  expect(
    await sendCommand('house.create', {}, 't', 'k', respond({ ok: false, error }, 409)),
  ).toEqual({
    ok: false,
    error,
  });
});

it('ramène une panne réseau ou une réponse illisible à INTERNAL', async () => {
  const down = vi.fn<typeof fetch>(async () => Promise.reject(new TypeError('offline')));
  expect(await sendCommand('x', {}, 't', 'k', down)).toMatchObject({ error: { code: 'INTERNAL' } });
  const html = vi.fn<typeof fetch>(async () => new Response('<html>502</html>', { status: 502 }));
  expect(await sendCommand('x', {}, 't', 'k', html)).toMatchObject({ error: { code: 'INTERNAL' } });
});

it('ramène une enveloppe mal formée à INTERNAL', async () => {
  for (const body of [
    { ok: false },
    { ok: 'yes', data: {} },
    { ok: true },
    { ok: false, error: 'x' },
    null,
  ]) {
    expect(await sendCommand('x', {}, 't', 'k', respond(body))).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL' },
    });
  }
});

it('génère une clé d’idempotence différente à chaque intention quand aucune n’est fournie', async () => {
  const fetchImpl = respond({ ok: true, data: {} });
  await sendCommand('x', {}, 't', undefined, fetchImpl);
  await sendCommand('x', {}, 't', undefined, fetchImpl);
  const keys = fetchImpl.mock.calls.map(([, init]) =>
    new Headers(init?.headers).get('Idempotency-Key'),
  );
  expect(keys[0]).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
  expect(keys[0]).not.toBe(keys[1]);
});

it('toute réponse de l’API, même un refus, donne l’heure du serveur', async () => {
  const { serverClock } = await import('./server-clock');
  const date = new Date(Date.now() - 5 * 3_600_000).toUTCString();
  const error = { code: 'NOTHING_TO_COLLECT', message: 'nothing' };
  await sendCommand(
    'site.collect',
    {},
    't',
    'k',
    vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ ok: false, error }), {
          status: 409,
          headers: { Date: date },
        }),
    ),
  );
  const behind = Date.now() - serverClock.now().getTime();
  expect(behind).toBeGreaterThan(5 * 3_600_000 - 2_000);
  expect(behind).toBeLessThan(5 * 3_600_000 + 2_000);
});

it('commandes du temple : chacune sous son nom, avec la valeur vue et la clé de son intention', async () => {
  const fetchImpl = respond({ ok: true, data: {} });
  vi.stubGlobal('fetch', fetchImpl);
  const offering = { godId: 'demeter', oboles: 6, goods: [], expectedCharis: 6 };
  await makeOffering(offering, 't', 'k1');
  await invokeGrace('blessing', 150, 't', 'k2');
  await consultOracle(60, 't', 'k3');
  vi.unstubAllGlobals();
  expect(
    fetchImpl.mock.calls.map(([url, init]) => [
      url,
      init?.body,
      new Headers(init?.headers).get('Idempotency-Key'),
    ]),
  ).toEqual([
    ['/api/commands/temple.makeOffering', JSON.stringify(offering), 'k1'],
    ['/api/commands/temple.invokeGrace', '{"graceId":"blessing","expectedCharisSpent":150}', 'k2'],
    ['/api/commands/temple.consultOracle', '{"expectedOboles":60}', 'k3'],
  ]);
});
