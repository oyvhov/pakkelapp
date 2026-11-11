// Run against a disposable empty instance, never the production database.
// node scripts/test-privacy.mjs http://127.0.0.1:8432 testkode
import assert from 'node:assert/strict';

const [base, code] = process.argv.slice(2);
assert(base && code, 'Provide the test instance URL and invitation code');
const api = async (user, method, path, body) => {
  const response = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: user.token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
};
const register = async (name) => {
  const response = await api(null, 'POST', '/api/jul/register', { code, name, email: `${name}@privacy.test`, password: 'PrivacyTest123!' });
  assert.equal(response.status, 200);
  return { id: response.body.record.id, token: response.body.token };
};
const create = async (user, collection, body) => {
  const response = await api(user, 'POST', `/api/collections/${collection}/records`, body);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body;
};
const list = async (user, collection, filter = '') => api(user, 'GET', `/api/collections/${collection}/records?filter=${encodeURIComponent(filter)}`);
const alice = await register('PrivacyAlice');
const bob = await register('PrivacyBob');
const eve = await register('PrivacyEve');
const people = (await list(alice, 'people')).body.items;
const pA = people.find((p) => p.user === alice.id).id;
const pB = people.find((p) => p.user === bob.id).id;
const pE = people.find((p) => p.user === eve.id).id;

const child = await create(alice, 'people', { name: 'Private child', created_by: alice.id });
const expense = await create(alice, 'expenses', {
  title: 'Private expense', note: 'Financial secret', kind: 'expense', amount: 10000,
  payers: [{ person: child.id, ore: 10000 }], shares: [{ person: pA, weight: 1 }], created_by: alice.id,
});
const cover = (user, personId, targetId) => api(user, 'POST', '/api/jul/covered-by', { personId, targetId });
assert.equal((await api(eve, 'GET', `/api/collections/expenses/records/${expense.id}`)).status, 404);
assert.equal((await cover(eve, child.id, pE)).status, 403);
assert.equal((await api(eve, 'GET', `/api/collections/expenses/records/${expense.id}`)).status, 404);
assert.equal(child.id in (await api(eve, 'GET', '/api/jul/settle')).body.wallets, false);
assert.equal((await cover(alice, child.id, pA)).status, 204);
const adoption = await api(null, 'POST', '/api/jul/register', { code, name: 'Hijack', email: 'hijack@privacy.test', password: 'PrivacyTest123!', personId: child.id });
assert.equal(adoption.status, 400);
assert.equal((await list(alice, 'people', `id="${child.id}"`)).body.items[0].user, '');
console.log('PASS household ownership, registration and hidden wallet IDs');

const wishlist = await create(alice, 'lists', { owner: alice.id, name: 'Private wishlist', kind: 'wishes', person: pA, visibility: 'private', year: 2026 });
const shared = await create(alice, 'gifts', { list: wishlist.id, title: 'Shared wish', created_by: alice.id, shared_with: [eve.id] });
const secret = await create(alice, 'gifts', { list: wishlist.id, title: 'Unshared wish', created_by: alice.id });
const token = (await api(alice, 'POST', `/api/jul/lists/${wishlist.id}/share`, { enabled: true })).body.token;
assert(token);
assert.equal((await api(alice, 'GET', `/api/collections/lists/records/${wishlist.id}`)).body.share_token, token);
const narrowed = await api(eve, 'GET', `/api/collections/lists/records/${wishlist.id}`);
assert.equal(narrowed.status, 200);
assert.equal(narrowed.body.share_token, undefined);
const expanded = await api(eve, 'GET', `/api/collections/gifts/records/${shared.id}?expand=list`);
assert.equal(expanded.body.expand.list.id, wishlist.id);
assert.equal(expanded.body.expand.list.share_token, undefined);
assert.equal((await api(eve, 'GET', `/api/collections/gifts/records/${secret.id}`)).status, 404);
assert((await api(null, 'GET', `/api/jul/shared/${token}`)).body.gifts.some((g) => g.id === secret.id));
assert.equal((await api(eve, 'GET', `/api/collections/lists/records?sort=share_token`)).status, 400);
assert.equal((await list(eve, 'lists', `share_token ~ "${token.slice(0, 3)}"`)).status, 400);
assert.equal((await api(alice, 'POST', `/api/jul/lists/${wishlist.id}/share`, { enabled: false })).status, 200);
assert.equal((await api(null, 'GET', `/api/jul/shared/${token}`)).status, 404);
console.log('PASS single-wish isolation, owner link management, expanded records and public link revocation');

await create(alice, 'person_notes', { user: alice.id, person: pB, interests: 'private-note-secret' });
await create(eve, 'person_notes', { user: eve.id, person: pB, interests: 'attacker-own-note' });
for (const field of ['person_notes_via_person.interests', '@collection.person_notes.interests', '@collection.person_notes:alias.interests']) {
  for (const operator of ['!~', '?~', '!=']) {
    assert.equal((await list(eve, 'people', `id="${pB}" && ${field} ${operator} "private-note"`)).status, 400);
  }
}
assert.equal((await api(eve, 'GET', '/api/collections/people/records?sort=person_notes_via_person.interests')).status, 400);
assert.equal((await list(eve, 'people', `id="${pB}"`)).body.items.length, 1);
assert.equal((await list(eve, 'people', 'name="someone.example"')).status, 200);
const ownNotes = await list(eve, 'person_notes');
assert.equal(ownNotes.body.items.length, 1);
assert.equal(ownNotes.body.items[0].interests, 'attacker-own-note');
console.log('PASS private note query isolation, aliases, sort and ordinary root-field filters');

// Exercise the same query boundary through normalized realtime options.
const controller = new AbortController();
const stream = await fetch(`${base}/api/realtime`, { signal: controller.signal });
const reader = stream.body.getReader();
let buffered = '';
while (!buffered.includes('\n\n')) buffered += new TextDecoder().decode((await reader.read()).value);
const connected = JSON.parse(buffered.split('\n').find((line) => line.startsWith('data:')).slice(5));
const clientId = connected.clientId;
assert(clientId);
const subscribe = (filter) => api(eve, 'POST', '/api/realtime', {
  clientId,
  subscriptions: [`people/*?options=${encodeURIComponent(JSON.stringify({ query: { filter } }))}`],
});
assert.equal((await subscribe('person_notes_via_person.interests !~ "private-note"')).status, 400);
assert.equal((await subscribe(`id="${pB}"`)).status, 204);
controller.abort();
console.log('PASS realtime query isolation and ordinary subscriptions');
console.log('All privacy regression checks passed');
