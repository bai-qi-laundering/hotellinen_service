const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('sendwash updates preserve active department and render only visible changes, including removals', async () => {
  const source = fs.readFileSync('sendwash-verification.js', 'utf8');
  let emit, renders = 0;
  const api = {
    collection: () => ({}), where: () => ({}), query: () => ({}),
    onSnapshot: (_, callback) => { emit = callback; return () => {}; }
  };
  const context = vm.createContext({
    window: { SendwashCore: { outletItem: (outlet, item) => outlet ? `【${outlet}】${item}` : item } },
    userInputs: {}, currentHotelName: '洲際 餐廳',
    document: { getElementById: () => ({ value: '2026-10-22' }) },
    renderItems: () => { renders++; }, showMessage: () => {}
  });
  // The adapter is assigned by the page's Firebase import; use a local adapter for the listener fixture.
  const instrumented = source.replace(
    "api=await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js')",
    'api=globalThis.fixtureApi'
  );
  context.fixtureApi = api;
  vm.runInContext(instrumented, context);
  await context.window.startSendwashVerification({});
  await context.window.attachSendwashListener(['2026-10-22']);
  const change = (type, id, hotel, date = '2026-10-22') => ({ type, doc: { id, data: () => ({ targetDate: date, inventoryHotel: hotel, items: [{ item: '口布', quantity: 1 }] }) } });
  emit({ docChanges: () => [change('added', 'other', '其他飯店')] });
  assert.equal(renders, 0);
  emit({ docChanges: () => [change('added', 'visible', '洲際 餐廳')] });
  assert.equal(renders, 1);
  assert.deepEqual(Array.from(context.window.sendwashPendingItems('2026-10-22', '洲際 餐廳')), ['口布']);
  emit({ docChanges: () => [change('removed', 'visible', '洲際 餐廳')] });
  assert.equal(renders, 2);
  assert.deepEqual(Array.from(context.window.sendwashPendingItems('2026-10-22', '洲際 餐廳')), []);
});
