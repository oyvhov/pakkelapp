// Testar tilgangsreglane mot ein køyrande server med tom database.
// Bruk: node scripts/test-access.mjs http://127.0.0.1:8431 invitasjonskode
const [base, code] = process.argv.slice(2);
let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'OK  ' : 'FEIL'} ${name} ${ok ? '' : extra}`);
  if (!ok) failed++;
};
const api = async (token, method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json };
};
const run = Date.now();
const register = async (name, personId) => {
  const r = await api(null, 'POST', '/api/jul/register', { code, name, email: `${name}${run}@test.local`, password: 'testpassord1', personId });
  if (r.status !== 200) throw new Error(`register ${name}: ${r.status} ${JSON.stringify(r.json)}`);
  return { token: r.json.token, id: r.json.record.id, name };
};
const list = (u, col, filter = '') => api(u.token, 'GET', `/api/collections/${col}/records?perPage=500${filter ? `&filter=${encodeURIComponent(filter)}` : ''}`).then((r) => r.json.items ?? []);
const create = (u, col, body) => api(u.token, 'POST', `/api/collections/${col}/records`, body);
const has = (items, id) => items.some((x) => x.id === id);

const bad = await api(null, 'POST', '/api/jul/register', { code: 'feil', name: 'X', email: 'x@test.local', password: 'testpassord1' });
check('registrering krev rett kode', bad.status === 403);
const direct = await api(null, 'POST', '/api/collections/users/records', { email: 'y@test.local', password: 'testpassord1', passwordConfirm: 'testpassord1' });
check('kan ikkje opprette brukar direkte', direct.status >= 400);
const anonPeople = await api(null, 'GET', '/api/collections/people/records');
check('anonym får ikkje lese folk', (anonPeople.json.items ?? []).length === 0);

const anna = await register('Anna');
const bjorn = await register('Bjorn');
const cato = await register('Cato');

const people = await list(anna, 'people');
const personOf = (u) => people.find((p) => p.user === u.id);
check('alle får ein person', [anna, bjorn, cato].every(personOf));

const annaLists = await list(anna, 'lists', `owner = "${anna.id}"`);
const wishes = annaLists.find((l) => l.kind === 'wishes');
const annaPlan = annaLists.find((l) => l.kind === 'plan');
check('standardlister blir oppretta', wishes && annaPlan);

const wish = (await create(anna, 'gifts', { list: wishes.id, title: 'Kikkert', created_by: anna.id, price: 1200 })).json;
check('kan leggje til ønske', !!wish.id);
check('familien ser ønsket', has(await list(bjorn, 'gifts'), wish.id));
check('andre kan ikkje endre ønsket', (await api(bjorn.token, 'PATCH', `/api/collections/gifts/records/${wish.id}`, { title: 'Hack' })).status >= 400);

const claim = await create(bjorn, 'claims', { gift: wish.id, user: bjorn.id, status: 'reserved' });
check('Bjørn kan reservere', claim.status === 200, JSON.stringify(claim.json));
check('Cato ser reservasjonen', has(await list(cato, 'claims'), claim.json.id));
check('Anna ser IKKJE reservasjon på eige ønske', !has(await list(anna, 'claims'), claim.json.id));
check('Anna får ikkje hente reservasjonen direkte', (await api(anna.token, 'GET', `/api/collections/claims/records/${claim.json.id}`)).status === 404);
check('Anna kan ikkje reservere eige ønske', (await create(anna, 'claims', { gift: wish.id, user: anna.id, status: 'reserved' })).status >= 400);
check('kan ikkje reservere i andre sitt namn', (await create(cato, 'claims', { gift: wish.id, user: bjorn.id, status: 'reserved' })).status >= 400);

const note = await create(bjorn, 'comments', { gift: wish.id, user: bjorn.id, text: 'Spleise?' });
check('Bjørn kan kommentere', note.status === 200, JSON.stringify(note.json));
check('Cato ser kommentaren', has(await list(cato, 'comments'), note.json.id));
check('Anna ser IKKJE kommentar på eige ønske', !has(await list(anna, 'comments'), note.json.id));

const privateGift = (await create(anna, 'gifts', { list: annaPlan.id, title: 'Hemmeleg', created_by: anna.id, recipients: [personOf(cato).id], status: 'idea' })).json;
check('privat plan er skjult for andre', !has(await list(bjorn, 'gifts'), privateGift.id) && !has(await list(bjorn, 'lists'), annaPlan.id));

const shared = (await create(anna, 'lists', { name: 'Delt', kind: 'plan', visibility: 'shared', owner: anna.id, editors: [bjorn.id, cato.id], year: 2026 })).json;
const toCato = (await create(anna, 'gifts', { list: shared.id, title: 'Til Cato', created_by: anna.id, recipients: [personOf(cato).id], status: 'idea' })).json;
const toBoth = (await create(bjorn, 'gifts', { list: shared.id, title: 'Til Cato og Bjørn', created_by: bjorn.id, recipients: [personOf(cato).id, personOf(bjorn).id], status: 'idea' })).json;
const noRecipient = (await create(anna, 'gifts', { list: shared.id, title: 'Utan mottakar', created_by: anna.id, status: 'idea' })).json;
check('medredaktør kan leggje til', !!toBoth.id, JSON.stringify(toBoth));
check('medredaktør ser delt gåve', has(await list(bjorn, 'gifts'), toCato.id));
check('mottakar ser IKKJE gåva sjølv om hen er medredaktør', !has(await list(cato, 'gifts'), toCato.id));
check('mottakar ser IKKJE gåve med fleire mottakarar', !has(await list(cato, 'gifts'), toBoth.id));
check('mottakar får ikkje hente gåva direkte', (await api(cato.token, 'GET', `/api/collections/gifts/records/${toCato.id}`)).status === 404);
check('mottakar kan ikkje endre gåva', (await api(cato.token, 'PATCH', `/api/collections/gifts/records/${toCato.id}`, { title: 'x' })).status >= 400);
check('gåve utan mottakar er synleg for medredaktør', has(await list(cato, 'gifts'), noRecipient.id));
const planNote = await create(bjorn, 'comments', { gift: toCato.id, user: bjorn.id, text: 'Hysj' });
check('Bjørn kan kommentere planlagd gåve', planNote.status === 200, JSON.stringify(planNote.json));
check('mottakar ser IKKJE kommentar på eiga gåve', !has(await list(cato, 'comments'), planNote.json.id));

check('medredaktør kan ikkje endre deling', (await api(bjorn.token, 'PATCH', `/api/collections/lists/records/${shared.id}`, { visibility: 'family' })).status >= 400);
check('medredaktør kan endre namn', (await api(bjorn.token, 'PATCH', `/api/collections/lists/records/${shared.id}`, { name: 'Nytt' })).status === 200);
check('kan ikkje gjere seg til eigar av brukar', (await api(bjorn.token, 'PATCH', `/api/collections/users/records/${bjorn.id}`, { is_owner: true })).status >= 400);
check('andre sine e-postar er skjulte', !(await list(bjorn, 'users')).find((u) => u.id === anna.id)?.email);

const boy = (await create(anna, 'people', { name: 'Vesle Emil', created_by: anna.id })).json;
check('kan leggje til person utan konto', !!boy.id, JSON.stringify(boy));
check('kan ikkje knyte person til konto sjølv', (await create(anna, 'people', { name: 'X', created_by: anna.id, user: bjorn.id })).status >= 400);
const info = await api(null, 'GET', `/api/jul/invite/${code}`);
check('invitasjon viser ledige personar', (info.json.people ?? []).some((p) => p.id === boy.id));
const emil = await register('Emil', boy.id);
check('kan overta ein eksisterande person', (await list(emil, 'people')).find((p) => p.id === boy.id)?.user === emil.id);

const ssrf = await api(anna.token, 'POST', '/api/jul/preview', { url: 'http://127.0.0.1:8080/api/health' });
check('lenkehenting når ikkje interne adresser', ssrf.status === 200 && !ssrf.json.title, JSON.stringify(ssrf.json));
const ssrfImg = await api(anna.token, 'GET', `/api/jul/image?url=${encodeURIComponent('http://169.254.169.254/latest')}`);
check('biletehenting når ikkje interne adresser', ssrfImg.status === 400);
check('lenkehenting krev innlogging', (await api(null, 'POST', '/api/jul/preview', { url: 'https://example.com' })).status === 401);

// Oppgjer
const pA = personOf(anna).id, pB = personOf(bjorn).id;
const exp = await create(anna, 'expenses', {
  title: 'Felles gåve', kind: 'expense', amount: 30000, created_by: anna.id,
  payers: [{ person: pA, ore: 0 }], shares: [{ person: pA, weight: 1 }, { person: pB, weight: 1 }],
  allocated: { [pB]: 1 }, visible_to: [cato.id],
});
check('utlegg kan lagrast', exp.status === 200, JSON.stringify(exp.json));
check('serveren reknar sjølv ut delinga', exp.json.allocated?.[pB] === 15000, JSON.stringify(exp.json.allocated));
check('den som er med ser utlegget', has(await list(bjorn, 'expenses'), exp.json.id));
check('andre ser ikkje utlegget', !has(await list(cato, 'expenses'), exp.json.id));
check('andre kan ikkje endre utlegget', (await api(bjorn.token, 'PATCH', `/api/collections/expenses/records/${exp.json.id}`, { amount: 100 })).status >= 400);
const badSplit = await create(anna, 'expenses', { title: 'x', kind: 'expense', amount: 100, created_by: anna.id, payers: [{ person: pA, ore: 50 }, { person: pB, ore: 20 }], shares: [{ person: pA, weight: 1 }] });
check('feil sum på betalarar blir avvist', badSplit.status >= 400);
const settle = (u) => api(u.token, 'GET', '/api/jul/settle').then((r) => r.json);
check('Bjørn skuldar 150 kr', (await settle(bjorn)).owe === 15000);
check('Anna har 150 kr til gode', (await settle(anna)).owed === 15000);
check('Cato ser ikkje andre sitt oppgjer', (await settle(cato)).transfers.length === 0);
const waiveBad = await create(bjorn, 'settlements', { from_person: pB, to_person: pA, amount: 15000, kind: 'waived', created_by: bjorn.id });
check('skuldnar kan ikkje ettergje eiga skuld', waiveBad.status >= 400);
const paid = await create(bjorn, 'settlements', { from_person: pB, to_person: pA, amount: 5000, kind: 'paid', status: 'confirmed', method: 'vipps', created_by: bjorn.id });
check('betaling frå skuldnar ventar på stadfesting', paid.json.status === 'pending', JSON.stringify(paid.json));
check('uoverstadfesta betaling tel ikkje', (await settle(bjorn)).owe === 15000);
check('skuldnar kan ikkje stadfeste sjølv', (await api(bjorn.token, 'PATCH', `/api/collections/settlements/records/${paid.json.id}`, { status: 'confirmed' })).status >= 400);
check('mottakar kan stadfeste', (await api(anna.token, 'PATCH', `/api/collections/settlements/records/${paid.json.id}`, { status: 'confirmed' })).status === 200);
check('delbetaling blir trekt frå', (await settle(bjorn)).owe === 10000);
await api(bjorn.token, 'POST', `/api/jul/expenses/${exp.json.id}/dispute`);
check('innvending snur ikkje ei skuld som er delbetalt', (await settle(bjorn)).owe === 10000);
check('innvending blir varsla', (await settle(anna)).disputed === 1);
await api(bjorn.token, 'POST', `/api/jul/expenses/${exp.json.id}/dispute`);
check('innvending kan trekkjast', (await settle(anna)).disputed === 0);
const waive = await create(anna, 'settlements', { from_person: pB, to_person: pA, amount: 10000, kind: 'waived', created_by: anna.id });
check('kreditor kan ettergje', waive.json.status === 'confirmed', JSON.stringify(waive.json));
check('skulda er borte etter ettergjeving', (await settle(bjorn)).transfers.length === 0);
check('person med utlegg kan ikkje slettast', (await api(anna.token, 'DELETE', `/api/collections/people/records/${pA}`)).status >= 400);

// Spoilarvern som ikkje kan skruast av
const ownerShared = (await create(anna, 'lists', { name: 'Eiga', kind: 'plan', visibility: 'shared', owner: anna.id, editors: [bjorn.id, cato.id], year: 2026 })).json;
const toOwner = (await create(bjorn, 'gifts', { list: ownerShared.id, title: 'Til eigaren', created_by: bjorn.id, recipients: [pA], status: 'idea' })).json;
check('listeeigar ser ikkje gåve meint til seg', !has(await list(anna, 'gifts'), toOwner.id));
const ownerNote = await create(cato, 'comments', { gift: toOwner.id, user: cato.id, text: 'Hysj' });
check('listeeigar ser ikkje prat om gåva', !has(await list(anna, 'comments'), ownerNote.json.id));
const mine = (await create(anna, 'gifts', { list: ownerShared.id, title: 'Til meg sjølv', created_by: anna.id, recipients: [pA], status: 'idea' })).json;
check('den som la inn gåva ser henne', has(await list(anna, 'gifts'), mine.id));
check('listetype kan ikkje endrast', (await api(cato.token, 'PATCH', `/api/collections/lists/records/${ownerShared.id}`, { kind: 'wishes' })).status >= 400);
check('person på ønskeliste kan ikkje fjernast', (await api(anna.token, 'PATCH', `/api/collections/lists/records/${wishes.id}`, { person: '' })).status >= 400);
check('ønskeliste må ha ein person', (await create(anna, 'lists', { name: 'x', kind: 'wishes', visibility: 'family', owner: anna.id, year: 2026 })).status >= 400);

// Ingen kan få skuld lagt på seg utan å seie ja
const cover = (u, personId, targetId) => api(u.token, 'POST', '/api/jul/covered-by', { personId, targetId });
const pC = personOf(cato).id;
check('kan ikkje setje kostnader via andre direkte', (await api(cato.token, 'PATCH', `/api/collections/people/records/${pC}`, { covered_by: pA })).status >= 400);
const asked = await cover(cato, pC, pA);
const afterAsk = (await list(anna, 'people')).find((p) => p.id === pC);
check('førespurnad gjeld ikkje før den andre seier ja', asked.status === 204 && afterAsk.covered_by === '' && afterAsk.covered_request === pA, JSON.stringify(afterAsk));
check('den som spør kan ikkje godta sjølv', (await cover(cato, pC, pA)).status === 204 && (await list(anna, 'people')).find((p) => p.id === pC).covered_by === '');
check('tredjeperson kan ikkje godta', (await cover(bjorn, pC, pA)).status === 403);
check('den andre kan godta', (await cover(anna, pC, pA)).status === 204 && (await list(anna, 'people')).find((p) => p.id === pC).covered_by === pA);
check('hushald kan ikkje gå i ring', (await cover(anna, pA, pC)).status === 400);
check('kan melde seg ut av hushald', (await cover(cato, pC, '')).status === 204 && (await list(anna, 'people')).find((p) => p.id === pC).covered_by === '');
const kid = (await create(anna, 'people', { name: 'Vesle Ida', created_by: anna.id })).json;
check('andre kan ikkje leggje eit barn på ein annan', (await cover(bjorn, kid.id, pC)).status === 403);
check('ein kan ta på seg kostnader for barn', (await cover(anna, kid.id, pA)).status === 204);

// Privat liste over kven som skal få gåve
const mark = await create(anna, 'recipients', { user: anna.id, person: pB, year: 2026 });
check('kan velje kven som skal få gåve', mark.status === 200, JSON.stringify(mark.json));
check('kan velje utan å ha noka gåve', (await list(anna, 'recipients')).length === 1);
check('andre ser ikkje lista mi', !has(await list(bjorn, 'recipients'), mark.json.id));
check('andre får ikkje hente frå lista mi', (await api(bjorn.token, 'GET', `/api/collections/recipients/records/${mark.json.id}`)).status === 404);
check('kan ikkje skrive på andre si liste', (await create(bjorn, 'recipients', { user: anna.id, person: pA, year: 2026 })).status >= 400);
check('andre kan ikkje slette frå lista mi', (await api(bjorn.token, 'DELETE', `/api/collections/recipients/records/${mark.json.id}`)).status >= 400);
check('same person kan ikkje veljast to gonger', (await create(anna, 'recipients', { user: anna.id, person: pB, year: 2026 })).status >= 400);
const bMark = await create(bjorn, 'recipients', { user: bjorn.id, person: pA, year: 2026 });
check('administrator ser ikkje andre si liste', !has(await list(anna, 'recipients'), bMark.json.id));

// Administrasjon: Anna er administrator fordi ho registrerte seg fyrst.
const bPlan = (await list(bjorn, 'lists', `owner = "${bjorn.id}"`)).find((l) => l.kind === 'plan');
const bSecret = (await create(bjorn, 'gifts', { list: bPlan.id, title: 'Bjørn sin løyndom', created_by: bjorn.id, status: 'idea' })).json;
check('administrator ser ikkje andre sine private lister', !has(await list(anna, 'lists'), bPlan.id));
check('administrator ser ikkje andre sine private gåver', !has(await list(anna, 'gifts'), bSecret.id));
check('administrator får ikkje hente privat gåve direkte', (await api(anna.token, 'GET', `/api/collections/gifts/records/${bSecret.id}`)).status === 404);
const overview = await api(anna.token, 'GET', '/api/jul/admin');
check('administrator når innstillingane', overview.status === 200);
check('administrasjon inneheld ikkje gåver eller lister', !JSON.stringify(overview.json).includes('løyndom') && !('gifts' in overview.json) && !('lists' in overview.json));
check('vanleg brukar når ikkje administrasjon', (await api(bjorn.token, 'GET', '/api/jul/admin')).status === 403);
check('vanleg brukar kan ikkje endre innstillingar', (await api(bjorn.token, 'PATCH', '/api/jul/admin/settings', { aiEnabled: false })).status === 403);
check('innstillingar kan ikkje lesast som samling', (await api(bjorn.token, 'GET', '/api/collections/app_settings/records')).status >= 400);
check('kan ikkje gjere seg til administrator sjølv', (await api(bjorn.token, 'PATCH', `/api/collections/users/records/${bjorn.id}`, { disabled: false })).status >= 400);
check('administrator kan ikkje stengje seg sjølv ute', (await api(anna.token, 'PATCH', `/api/jul/admin/members/${anna.id}`, { disabled: true })).status >= 400);
await api(anna.token, 'PATCH', `/api/jul/admin/members/${cato.id}`, { disabled: true });
check('pausa brukar mistar tilgangen straks', (await api(cato.token, 'GET', '/api/jul/settle')).status === 401);
const paused = await api(null, 'POST', '/api/collections/users/auth-with-password', { identity: `Cato${run}@test.local`.toLowerCase(), password: 'testpassord1' });
check('pausa brukar kan ikkje logge inn', paused.status === 403, JSON.stringify(paused));
await api(anna.token, 'PATCH', '/api/jul/admin/settings', { signupOpen: false });
check('stengt registrering stoppar invitasjonen', (await api(null, 'GET', `/api/jul/invite/${code}`)).status === 403);

console.log(failed ? `\n${failed} feil` : '\nAlle tilgangstestar passerte');
process.exit(failed ? 1 : 0);
