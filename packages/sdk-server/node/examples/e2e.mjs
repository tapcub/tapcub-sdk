// End-to-end scenario against a running TapCub API. Used by scripts/smoke-sdk-server.mjs in the main repository.
//   TAPCUB_API_KEY=wck_… TAPCUB_ENDPOINT=http://localhost:3001 TAPCUB_RUN=abc node --experimental-strip-types examples/e2e.mjs
import { TapCub } from '../src/index.ts';

const lang = 'node';
const run = process.env.TAPCUB_RUN ?? Date.now().toString(36);
const apiKey = process.env.TAPCUB_API_KEY;
const endpoint = process.env.TAPCUB_ENDPOINT;
const user = `${lang}-${run}`;

// 1. Validate one event without storing it
const debug = new TapCub({ apiKey, endpoint, consumer: 'debug', logger: { warn: () => {}, error: console.error } });
await debug.track('sdk_e2e_debug', { loginId: user });

// 2. Batch client: everything below goes out in one request on close()
const errors = [];
const tc = new TapCub({ apiKey, endpoint, onError: (e) => errors.push(e) });
tc.trackSignup(user, { deviceId: `custom:${lang}${run}dev`, invitedBy: 'e2e-inviter', context: { campaign: { source: 'e2e', medium: 'sdk', name: lang } } });
tc.track('sdk_e2e_purchase', {
  loginId: user,
  insertId: `${user}-o1`,
  properties: { revenue: 19.9, currency: 'USD', items: [{ item_id: `sku-${lang}`, price: 19.9, quantity: 1 }] },
  context: { ip: '203.0.113.7', user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)', url: 'https://shop.example.com/checkout' },
});
tc.bind(user, { email: `${user}@example.com` });
tc.profileSet(user, { plan: 'pro', $name: `E2E ${lang}` });
tc.profileSetOnce(user, { first_source: 'e2e' });
tc.profileIncrement(user, { orders: 1 });
tc.profileAppend(user, { tags: ['e2e'] });
tc.itemSet('product', `sku-${lang}`, { name: 'Shoe', price: 19.9 });
tc.groupSet('company', `acme-${lang}`, { name: 'Acme' });
tc.track('sdk_e2e_seat', { loginId: user, group: `company:acme-${lang}` });
await tc.close();

if (errors.length) {
  console.error(errors.map((e) => e.message).join('\n'));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, lang, user }));
