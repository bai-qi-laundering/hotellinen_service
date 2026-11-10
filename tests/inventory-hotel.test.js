import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../inventory-hotel.js');
const { belongs, resolve } = globalThis.InventoryHotel;

const judan = { baseName: '巨蛋', deptName: '房務', hotel: '巨蛋 房務', item: '抹布' };
const boliOnJudan = { baseName: '巨蛋', deptName: '房務', hotel: '鉑麗 房務', item: '抹布' };
const boli = { baseName: '鉑麗', deptName: '房務', hotel: '鉑麗 房務', item: '抹布' };

test('a row that names another hotel cannot take over 巨蛋', () => {
  assert.equal(resolve('巨蛋', '房務', [boliOnJudan, judan]), '巨蛋 房務');
  assert.equal(resolve('巨蛋', '房務', [judan, boliOnJudan]), '巨蛋 房務');
  assert.equal(resolve('巨蛋', '房務', [boliOnJudan]), '巨蛋 房務');
  assert.equal(resolve('鉑麗', '房務', [boli, boliOnJudan]), '鉑麗 房務');
});

test('房務 with no template row keeps the historical bare name', () => {
  assert.equal(resolve('巨蛋', '房務', []), '巨蛋');
  assert.equal(resolve('巨蛋', '回洗', []), '巨蛋 回洗');
});

test('巨蛋 does not belong to 巨蛋一般 or 鉑麗', () => {
  assert.equal(belongs('巨蛋', '巨蛋 房務'), true);
  assert.equal(belongs('巨蛋', '巨蛋'), true);
  assert.equal(belongs('巨蛋', '巨蛋一般 一般處理'), false);
  assert.equal(belongs('巨蛋', '鉑麗 房務'), false);
  assert.equal(belongs('鉑麗', '鉑麗 房務'), true);
});

test('抹布 cards for the two hotels are different elements', () => {
  const id = name => 'id_' + Array.from(name).map(ch => ch.charCodeAt(0).toString(16)).join('_');
  const card = (hotel, item) => `card_${id(hotel)}_${id(item)}`;
  assert.notEqual(card('巨蛋 房務', '抹布'), card('鉑麗 房務', '抹布'));
});

test('inventory page pins the open hotel and refuses a foreign save', () => {
  const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(page, /if \(homeHidden && currentBaseHotel\) return/);
  assert.match(page, /inventorySaveTargetsOpenHotel/);
  assert.match(page, /沒有寫入/);
  assert.match(page, /window\.itemElementId\(itemName\)/);
  assert.match(page, /InventoryHotel\.resolve\(currentBaseHotel, currentDept, masterData\)/);
  assert.match(page, /onclick="goToHotel\('\$\{c\}'\)"/);
});
