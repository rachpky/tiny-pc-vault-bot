const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Range {
  constructor(sheet, row, col, rows, cols) { Object.assign(this, {sheet, row, col, rows, cols}); }
  getValues() {
    return Array.from({length: this.rows}, (_, r) => Array.from({length: this.cols}, (_, c) =>
      (this.sheet.rows[this.row - 1 + r] || [])[this.col - 1 + c] ?? ''));
  }
  setValue(value) {
    while (this.sheet.rows.length < this.row) this.sheet.rows.push([]);
    const target = this.sheet.rows[this.row - 1];
    while (target.length < this.col) target.push('');
    target[this.col - 1] = value;
    return this;
  }
  setValues(values) {
    values.forEach((row, r) => row.forEach((value, c) =>
      new Range(this.sheet, this.row + r, this.col + c, 1, 1).setValue(value)));
    return this;
  }
  setFontWeight() { return this; }
}

class Sheet {
  constructor(rows = []) { this.rows = rows.map(row => [...row]); }
  getLastColumn() { return this.rows.length ? Math.max(1, ...this.rows.map(row => row.length)) : 1; }
  getLastRow() { return this.rows.length; }
  getDataRange() { return new Range(this, 1, 1, Math.max(1, this.rows.length), this.getLastColumn()); }
  getRange(row, col, rows = 1, cols = 1) { return new Range(this, row, col, rows, cols); }
  appendRow(row) { this.rows.push([...row]); }
  setFrozenRows() {}
}

const inventoryHeaders = [
  'Card ID', 'Group', 'Member', 'Era / Album', 'Version', 'Card Type',
  'Store / Source', 'Cost Price', 'Selling Price', 'Profit', 'Status',
  'Buyer', 'Order ID', 'Telegram Post', 'Notes',
];
const inventory = new Sheet([
  inventoryHeaders,
  ['NORMAL-1', 'ATEEZ', 'San', 'Album', '', 'Album PC', '', 4, 8, 4, 'Available', '', '', '', ''],
  ['NORMAL-2', 'ATEEZ', 'Mingi', 'Album', '', 'Album PC', '', 4, 9, 5, 'Available', '', '', '', ''],
  ['A', 'ATEEZ', 'San', 'Set', '', 'POB', '', 2, 10, 8, 'Available', '', '', '', ''],
  ['B', 'ATEEZ', 'San', 'Set', '', 'POB', '', 2, 10, 8, 'Available', '', '', '', ''],
  ['C', 'ATEEZ', 'San', 'Set', '', 'POB', '', 2, 10, 8, 'Available', '', '', '', ''],
  ['D', 'ATEEZ', 'San', 'Set', '', 'POB', '', 2, 10, 8, 'Available', '', '', '', ''],
  ['E', 'ATEEZ', 'San', 'Set', '', 'POB', '', 2, 10, 8, 'Available', '', '', '', ''],
]);
const orders = new Sheet([
  ['Order ID', 'Order Date', 'Buyer Name', 'Telegram Username', 'Subtotal', 'Shipping',
   'Discount', 'Total', 'Payment Status', 'Delivery Method', 'Tracking No.', 'Order Status',
   'Paid Date', 'Mailed Date', 'Notes'],
  ['PC-0001', new Date(), 'Sample', '@sample', 9, 3, 0, 12, 'Paid', 'Tracked Mail', '', 'Mailed', '', '', ''],
]);
const orderItems = new Sheet([['Order ID', 'Card ID', 'Member', 'Description', 'Quantity', 'Line Total', 'Cost', 'Line Profit']]);
const sets = new Sheet([
  ['Set ID', 'Set Name', 'Claim Opens', 'Claim Closes', 'Sale Mode', 'Status'],
  ['SET-001', 'Priority Test Set', '', '', 'Priority', 'Claims Open'],
]);
const sheets = {Inventory: inventory, Orders: orders, 'Order Items': orderItems, Sets: sets};
const spreadsheet = {
  getSheetByName: name => sheets[name] || null,
  insertSheet: name => (sheets[name] = new Sheet()),
};

global.SpreadsheetApp = {openById: () => spreadsheet, flush: () => {}};
global.LockService = {getScriptLock: () => ({waitLock: () => {}, releaseLock: () => {}})};
global.PropertiesService = {getScriptProperties: () => ({getProperty: () => 'secret'})};
global.ContentService = {MimeType: {JSON: 'json'}, createTextOutput: value => ({setMimeType: () => value})};

for (const file of ['Code.gs', 'SheetHelpers.gs', 'Commerce.gs', 'Priority.gs']) {
  vm.runInThisContext(fs.readFileSync(file, 'utf8'), {filename: file});
}

setupShopApi();
assert.ok(sheets.Inventory.rows[0].includes('Telegram File ID'));
assert.ok(sheets.Orders.rows[0].includes('Telegram User ID'));
assert.ok(sheets.Claims && sheets['Claim Items']);

// First-come: only one buyer can hold the same PC.
holdCard_('NORMAL-1', 'buyer-1');
assert.equal(getCard_('NORMAL-1').status, 'Held');
assert.throws(() => holdCard_('NORMAL-1', 'buyer-2'), /already held or sold/);
assert.equal(listHolds_('buyer-1').length, 1);
const normalOrder = createOrder_({
  card_ids: ['NORMAL-1'], telegram_user_id: 'buyer-1', buyer_name: 'Buyer One',
  username: 'buyerone', shipping_method: 'normal',
});
assert.equal(normalOrder.order_id, 'PC-0002');
assert.equal(getCard_('NORMAL-1').status, 'Pending Payment');

// Expired holds release automatically, and Telegram image IDs persist on the card.
holdCard_('NORMAL-2', 'buyer-1');
const expiring = findRow_(sheets.Inventory, 'Card ID', 'NORMAL-2');
setCellByHeader_(sheets.Inventory, expiring.headers, expiring.row, 'Held Until', new Date(0));
assert.equal(listHolds_('buyer-1').length, 0);
assert.equal(getCard_('NORMAL-2').status, 'Available');
setCardPhoto_('NORMAL-2', 'telegram-file-id');
assert.equal(getCard_('NORMAL-2').telegram_file_id, 'telegram-file-id');

function tagSet(cardId) {
  const row = findRow_(sheets.Inventory, 'Card ID', cardId);
  setCellByHeader_(sheets.Inventory, row.headers, row.row, 'Set ID', 'SET-001');
  setCellByHeader_(sheets.Inventory, row.headers, row.row, 'Sale Mode', 'Priority');
}
['A', 'B', 'C', 'D', 'E'].forEach(tagSet);

function claim(user, name, cards) {
  cards.forEach(card_id => addClaimItem_({
    card_id, telegram_user_id: user, buyer_name: name, username: name.toLowerCase(),
  }));
}
claim('rachel-id', 'Rachel', ['A', 'B', 'C', 'D']);
claim('jane-id', 'Jane', ['A', 'B', 'E']);
claim('sarah-id', 'Sarah', ['C']);
assert.equal(listClaims_('rachel-id')[0].quantity, 4);
assert.equal(getCard_('A').claim_count, 2);

const result = allocateSet_('SET-001');
const byUser = Object.fromEntries(result.allocations.map(item => [item.telegram_user_id, item.card_ids.sort()]));
assert.deepEqual(byUser['rachel-id'], ['A', 'B', 'C', 'D']);
assert.deepEqual(byUser['jane-id'], ['E']);
assert.equal(byUser['sarah-id'], undefined);
assert.equal(allocationPreview_('SET-001', 'rachel-id').cards.length, 4);

const priorityOrder = createAllocationOrder_({
  set_id: 'SET-001', telegram_user_id: 'rachel-id', buyer_name: 'Rachel',
  username: 'rachel', shipping_method: 'tracked',
});
assert.equal(priorityOrder.total, 43);

// Cancelling a priority order forfeits the winner and reallocates released cards.
const cancelled = cancelOrder_(priorityOrder.order_id, 'rachel-id');
const reallocated = Object.fromEntries(cancelled.reallocations.map(item => [item.telegram_user_id, item.card_ids.sort()]));
assert.deepEqual(reallocated['jane-id'], ['A', 'B']);
assert.deepEqual(reallocated['sarah-id'], ['C']);
assert.equal(getCard_('D').status, 'Available');

console.log('Timed-hold, priority allocation and fallback tests passed.');
