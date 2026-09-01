function setMap_() {
  const map = {};
  records_(SETS_SHEET).forEach(row => map[String(row['Set ID'] || '')] = row);
  return map;
}

function saleMode_(row, sets) {
  const direct = String(row['Sale Mode'] || '').trim();
  const set = sets[String(row['Set ID'] || '')];
  return direct || (set && String(set['Sale Mode'] || '').trim()) || 'First-Come';
}

function isSetOpen_(set) {
  if (!set || String(set['Status'] || '') !== 'Claims Open') return false;
  const now = new Date();
  const opens = dateValue_(set['Claim Opens']);
  const closes = dateValue_(set['Claim Closes']);
  if (opens && now < opens) return false;
  if (closes && now >= closes) return false;
  return true;
}

function claimCounts_() {
  const counts = {};
  records_(CLAIM_ITEMS_SHEET).forEach(row => {
    if (String(row['Allocation'] || '') !== 'Pending') return;
    const cardId = String(row['Card ID'] || '');
    counts[cardId] = (counts[cardId] || 0) + 1;
  });
  return counts;
}

function normaliseCard_(row, sets, counts) {
  const setId = String(row['Set ID'] || '');
  const set = sets[setId] || {};
  return {
    id: String(row['Card ID'] || ''),
    group: String(row['Group'] || ''),
    member: String(row['Member'] || ''),
    album: String(row['Era / Album'] || ''),
    version: String(row['Version'] || ''),
    type: String(row['Card Type'] || ''),
    store: String(row['Store / Source'] || ''),
    price: number_(row['Selling Price']),
    status: String(row['Status'] || ''),
    set_id: setId,
    set_name: String(set['Set Name'] || ''),
    set_status: String(set['Status'] || ''),
    claim_open: isSetOpen_(set),
    claim_closes: serialiseValue_(set['Claim Closes']),
    sale_mode: saleMode_(row, sets),
    claim_count: counts[String(row['Card ID'] || '')] || 0,
    telegram_file_id: String(row['Telegram File ID'] || ''),
    held_by: String(row['Held By'] || ''),
    held_until: serialiseValue_(row['Held Until']),
  };
}

function listInventory_(member) {
  expireHolds_();
  const sets = setMap_();
  const counts = claimCounts_();
  return records_(INVENTORY_SHEET).map(row => normaliseCard_(row, sets, counts))
    .filter(card => card.id && card.status === 'Available')
    .filter(card => card.sale_mode !== 'Priority' || isSetOpen_(sets[card.set_id]))
    .filter(card => !member || card.member === member);
}

function getCard_(cardId) {
  if (!cardId) throw new Error('Card ID is required.');
  expireHolds_();
  const sets = setMap_();
  const counts = claimCounts_();
  const row = records_(INVENTORY_SHEET).find(item => String(item['Card ID']) === String(cardId));
  return row ? normaliseCard_(row, sets, counts) : null;
}

function setCardPhoto_(cardId, telegramFileId) {
  if (!cardId || !telegramFileId) throw new Error('Card ID and Telegram File ID are required.');
  const sheet = getSpreadsheet_().getSheetByName(INVENTORY_SHEET);
  const match = findRow_(sheet, 'Card ID', cardId);
  if (!match) throw new Error('Card not found.');
  setCellByHeader_(sheet, match.headers, match.row, 'Telegram File ID', telegramFileId);
  return getCard_(cardId);
}

function expireHolds_() {
  const sheet = getSpreadsheet_().getSheetByName(INVENTORY_SHEET);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return;
  const headers = headerMap_(values[0]);
  if (!('Held Until' in headers) || !('Held By' in headers)) return;
  const statusCol = requiredColumn_(headers, 'Status');
  const untilCol = requiredColumn_(headers, 'Held Until');
  const now = new Date();
  values.slice(1).forEach((row, index) => {
    const until = dateValue_(row[untilCol]);
    if (String(row[statusCol]) === 'Held' && (!until || until <= now)) {
      const sheetRow = index + 2;
      sheet.getRange(sheetRow, statusCol + 1).setValue('Available');
      setCellByHeader_(sheet, headers, sheetRow, 'Held By', '');
      setCellByHeader_(sheet, headers, sheetRow, 'Held Until', '');
    }
  });
}

function holdCard_(cardId, telegramUserId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (!cardId || !telegramUserId) throw new Error('Card ID and Telegram User ID are required.');
    expireHolds_();
    const sheet = getSpreadsheet_().getSheetByName(INVENTORY_SHEET);
    const match = findRow_(sheet, 'Card ID', cardId);
    if (!match) throw new Error('Card not found.');
    const sets = setMap_();
    const rowObject = {};
    Object.keys(match.headers).forEach(header => rowObject[header] = match.values[match.headers[header]]);
    if (saleMode_(rowObject, sets) === 'Priority') {
      throw new Error('Priority cards must be added to a claim, not a cart.');
    }
    const status = String(match.values[requiredColumn_(match.headers, 'Status')] || '');
    const heldBy = String(match.values[requiredColumn_(match.headers, 'Held By')] || '');
    if (status === 'Held' && heldBy === String(telegramUserId)) return getCard_(cardId);
    if (status !== 'Available') throw new Error('This card is already held or sold.');
    const until = new Date(Date.now() + HOLD_MINUTES * 60 * 1000);
    setCellByHeader_(sheet, match.headers, match.row, 'Status', 'Held');
    setCellByHeader_(sheet, match.headers, match.row, 'Held By', String(telegramUserId));
    setCellByHeader_(sheet, match.headers, match.row, 'Held Until', until);
    SpreadsheetApp.flush();
    return getCard_(cardId);
  } finally {
    lock.releaseLock();
  }
}

function listHolds_(telegramUserId) {
  if (!telegramUserId) throw new Error('Telegram User ID is required.');
  expireHolds_();
  const sets = setMap_();
  return records_(INVENTORY_SHEET)
    .filter(row => String(row['Status']) === 'Held' && String(row['Held By']) === String(telegramUserId))
    .map(row => normaliseCard_(row, sets, {}));
}

function releaseHolds_(cardIds, telegramUserId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const wanted = new Set((cardIds || []).map(String));
    const sheet = getSpreadsheet_().getSheetByName(INVENTORY_SHEET);
    const values = sheet.getDataRange().getValues();
    const headers = headerMap_(values[0]);
    const idCol = requiredColumn_(headers, 'Card ID');
    const statusCol = requiredColumn_(headers, 'Status');
    const heldByCol = requiredColumn_(headers, 'Held By');
    values.slice(1).forEach((row, index) => {
      if (wanted.size && !wanted.has(String(row[idCol]))) return;
      if (String(row[statusCol]) !== 'Held' || String(row[heldByCol]) !== String(telegramUserId)) return;
      const sheetRow = index + 2;
      setCellByHeader_(sheet, headers, sheetRow, 'Status', 'Available');
      setCellByHeader_(sheet, headers, sheetRow, 'Held By', '');
      setCellByHeader_(sheet, headers, sheetRow, 'Held Until', '');
    });
    SpreadsheetApp.flush();
    return {released: true};
  } finally {
    lock.releaseLock();
  }
}

function shippingOption_(method) {
  const options = {
    normal: {label: 'Normal Mail', price: 1.50},
    tracked: {label: 'Tracked Mail', price: 3.00},
    meetup: {label: 'Meetup', price: 0},
  };
  return options[method] || options.normal;
}

function createOrder_(request) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    expireHolds_();
    const cardIds = [...new Set((request.card_ids || []).map(String).filter(Boolean))];
    if (!cardIds.length) throw new Error('The cart is empty or its holds expired.');
    const rows = records_(INVENTORY_SHEET).filter(row => cardIds.includes(String(row['Card ID'])));
    if (rows.length !== cardIds.length) throw new Error('One or more cards could not be found.');
    rows.forEach(row => {
      if (String(row['Status']) !== 'Held' || String(row['Held By']) !== String(request.telegram_user_id)) {
        throw new Error('One or more cart holds expired or belong to another buyer.');
      }
    });
    return createOrderRows_(rows, request, 'First-Come', '');
  } finally {
    lock.releaseLock();
  }
}

function createAllocationOrder_(request) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (!request.set_id || !request.telegram_user_id) throw new Error('Set and buyer are required.');
    const rows = records_(INVENTORY_SHEET).filter(row =>
      String(row['Set ID']) === String(request.set_id) &&
      String(row['Status']) === 'Allocated' &&
      String(row['Allocated Telegram User ID']) === String(request.telegram_user_id)
    );
    if (!rows.length) throw new Error('No unprocessed allocation was found.');
    return createOrderRows_(rows, request, 'Priority', request.set_id);
  } finally {
    lock.releaseLock();
  }
}

function createOrderRows_(rows, request, source, setId) {
  const ss = getSpreadsheet_();
  const inventory = ss.getSheetByName(INVENTORY_SHEET);
  const orders = ss.getSheetByName(ORDERS_SHEET);
  const items = ss.getSheetByName(ORDER_ITEMS_SHEET);
  const orderId = nextId_(orders, 'Order ID', 'PC');
  const shipping = shippingOption_(request.shipping_method);
  const subtotal = rows.reduce((sum, row) => sum + number_(row['Selling Price']), 0);
  const username = request.username ? `@${String(request.username).replace(/^@/, '')}` : '';
  appendObjectRow_(orders, {
    'Order ID': orderId, 'Order Date': new Date(), 'Buyer Name': request.buyer_name || '',
    'Telegram Username': username, 'Subtotal': subtotal, 'Shipping': shipping.price,
    'Discount': 0, 'Total': subtotal + shipping.price, 'Payment Status': 'Unpaid',
    'Delivery Method': shipping.label, 'Order Status': 'Pending Payment',
    'Notes': `Created by Telegram bot (${source})`,
    'Telegram User ID': String(request.telegram_user_id), 'Order Source': source, 'Set ID': setId,
  });
  rows.forEach(row => {
    const album = String(row['Era / Album'] || '');
    const version = String(row['Version'] || '');
    const price = number_(row['Selling Price']);
    const cost = number_(row['Cost Price']);
    appendObjectRow_(items, {
      'Order ID': orderId, 'Card ID': row['Card ID'], 'Member': row['Member'],
      'Description': version ? `${album} – ${version}` : album, 'Quantity': 1,
      'Line Total': price, 'Cost': cost, 'Line Profit': price - cost,
    });
    const match = findRow_(inventory, 'Card ID', row['Card ID']);
    setCellByHeader_(inventory, match.headers, match.row, 'Status', 'Pending Payment');
    setCellByHeader_(inventory, match.headers, match.row, 'Buyer', username || request.buyer_name || '');
    setCellByHeader_(inventory, match.headers, match.row, 'Order ID', orderId);
    setCellByHeader_(inventory, match.headers, match.row, 'Held By', '');
    setCellByHeader_(inventory, match.headers, match.row, 'Held Until', '');
  });
  SpreadsheetApp.flush();
  return {order_id: orderId, subtotal: subtotal, shipping: shipping.price,
    delivery_method: shipping.label, total: subtotal + shipping.price,
    status: 'Pending Payment', source: source, set_id: setId};
}

function listOrders_(telegramUserId) {
  if (!telegramUserId) throw new Error('Telegram User ID is required.');
  return records_(ORDERS_SHEET)
    .filter(row => String(row['Telegram User ID'] || '') === String(telegramUserId))
    .map(row => ({
      order_id: String(row['Order ID'] || ''), total: number_(row['Total']),
      payment_status: String(row['Payment Status'] || ''),
      order_status: String(row['Order Status'] || ''),
      source: String(row['Order Source'] || ''), set_id: String(row['Set ID'] || ''),
    })).reverse();
}

function cancelOrder_(orderId, telegramUserId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = getSpreadsheet_();
    const orders = ss.getSheetByName(ORDERS_SHEET);
    const match = findRow_(orders, 'Order ID', orderId);
    if (!match) throw new Error('Order not found.');
    const get = header => match.values[requiredColumn_(match.headers, header)];
    if (String(get('Telegram User ID')) !== String(telegramUserId)) throw new Error('This order belongs to another buyer.');
    if (String(get('Order Status')) !== 'Pending Payment' || String(get('Payment Status')) !== 'Unpaid') {
      throw new Error('Only unpaid pending orders can be cancelled.');
    }
    setCellByHeader_(orders, match.headers, match.row, 'Order Status', 'Cancelled');
    const source = String(get('Order Source') || 'First-Come');
    const setId = String(get('Set ID') || '');
    const inventory = ss.getSheetByName(INVENTORY_SHEET);
    const released = [];
    records_(INVENTORY_SHEET).forEach(row => {
      if (String(row['Order ID']) !== String(orderId)) return;
      released.push(String(row['Card ID']));
      const card = findRow_(inventory, 'Card ID', row['Card ID']);
      setCellByHeader_(inventory, card.headers, card.row, 'Status', 'Available');
      setCellByHeader_(inventory, card.headers, card.row, 'Buyer', '');
      setCellByHeader_(inventory, card.headers, card.row, 'Order ID', '');
      if (source === 'Priority') {
        setCellByHeader_(inventory, card.headers, card.row, 'Allocated Buyer', '');
        setCellByHeader_(inventory, card.headers, card.row, 'Allocated Telegram User ID', '');
        setCellByHeader_(inventory, card.headers, card.row, 'Winning Claim ID', '');
      }
    });
    let reallocations = [];
    if (source === 'Priority' && setId) reallocations = requeuePriorityCards_(setId, released, telegramUserId);
    SpreadsheetApp.flush();
    return {order_id: String(orderId), status: 'Cancelled', set_id: setId, reallocations: reallocations};
  } finally {
    lock.releaseLock();
  }
}
