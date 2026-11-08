// VO-042 (FR-030, constitution X, research R3): the server listens on
// 127.0.0.1, on a port chosen at launch, and on no other local address.
//
// Starts `src/server/http.ts` (T044) through test/helpers/server.ts, which
// requires:
//
//   export function startServer(options: {
//     routes: readonly RouteModule[];
//     launchToken: string;
//   }): Promise<{ port: number; close(): Promise<void> }>;
//
// No extra options are passed, so startServer must start with only these two.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';
import { createTempAppData, type TempAppData } from '../helpers/app-data.ts';
import { startTestServer } from '../helpers/server.ts';

// The server logs to the app-data directory; keep that out of the user's real one.
let appData: TempAppData | undefined;
before(async () => {
  appData = await createTempAppData();
});
after(async () => {
  await appData?.cleanup();
});

type Probe = 'connected' | 'refused';

/** Opens a TCP connection; any error or a timeout counts as not reachable. */
function probe(host: string, port: number, timeoutMs = 1500): Promise<Probe> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (result: Probe): void => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs, () => done('refused'));
    socket.once('connect', () => done('connected'));
    socket.once('error', () => done('refused'));
  });
}

/** Every local address other than 127.0.0.1 a socket could reach the server on. */
function otherLocalAddresses(): string[] {
  const addresses = new Set<string>();
  for (const list of Object.values(networkInterfaces())) {
    for (const info of list ?? []) {
      // IPv6 link-local addresses need a zone to be reachable; skip them.
      if (info.address.toLowerCase().startsWith('fe80')) continue;
      if (info.address !== '127.0.0.1') addresses.add(info.address);
    }
  }
  // Linux routes all of 127.0.0.0/8 to loopback, so 127.0.0.2 reaches a
  // server bound to 0.0.0.0 even on a machine with no other interface.
  if (process.platform === 'linux') addresses.add('127.0.0.2');
  return [...addresses];
}

test('VO-042 the server listens on 127.0.0.1 on a port chosen at launch', async (t) => {
  const first = await startTestServer({ authenticate: false });
  t.after(() => first.close());
  const second = await startTestServer({ authenticate: false });
  t.after(() => second.close());

  for (const client of [first, second]) {
    assert.ok(Number.isInteger(client.port), `port ${client.port} is not an integer`);
    assert.ok(client.port > 0 && client.port < 65536, `port ${client.port} is out of range`);
    assert.equal(await probe('127.0.0.1', client.port), 'connected', 'not listening on 127.0.0.1');
    const res = await client.get('/launch', { cookie: false });
    assert.ok(res.status >= 100 && res.status < 600, `no HTTP answer on 127.0.0.1:${client.port}`);
  }
  assert.notEqual(first.port, second.port, 'two launches got the same fixed port');
});

test('VO-042 the server is not reachable on any other local address', async (t) => {
  const client = await startTestServer({ authenticate: false });
  t.after(() => client.close());

  assert.equal(await probe('127.0.0.1', client.port), 'connected', 'control: not listening on 127.0.0.1');

  const others = otherLocalAddresses();
  assert.ok(others.length > 0, 'no other local address to probe; the check would prove nothing');
  for (const address of others) {
    assert.equal(
      await probe(address, client.port),
      'refused',
      `the server on port ${client.port} is reachable on ${address}`,
    );
  }
});
