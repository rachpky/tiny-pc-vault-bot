function listSets_() {
  return records_(SETS_SHEET).map(row => ({
    set_id: String(row['Set ID'] || ''), set_name: String(row['Set Name'] || ''),
    sale_mode: String(row['Sale Mode'] || ''), status: String(row['Status'] || ''),
    claim_opens: serialiseValue_(row['Claim Opens']), claim_closes: serialiseValue_(row['Claim Closes']),
  })).filter(set => set.set_id);
}

function findSet_(setId) {
  return records_(SETS_SHEET).find(row => String(row['Set ID']) === String(setId)) || null;
}

function addClaimItem_(request) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (!request.card_id || !request.telegram_user_id) throw new Error('Card and buyer are required.');
    const card = records_(INVENTORY_SHEET).find(row => String(row['Card ID']) === String(request.card_id));
    if (!card) throw new Error('Card not found.');
    const setId = String(card['Set ID'] || '');
    const set = findSet_(setId);
    if (!setId || saleMode_(card, setMap_()) !== 'Priority') throw new Error('This is not a priority-set card.');
    if (!isSetOpen_(set)) throw new Error('Claims for this set are not open.');
    if (String(card['Status']) !== 'Available') throw new Error('This card is no longer claimable.');

    const ss = getSpreadsheet_();
    const claims = ss.getSheetByName(CLAIMS_SHEET);
    const items = ss.getSheetByName(CLAIM_ITEMS_SHEET);
    let claim = records_(CLAIMS_SHEET).find(row =>
      String(row['Set ID']) === setId &&
      String(row['Telegram User ID']) === String(request.telegram_user_id) &&
      !['Forfeited', 'Cancelled'].includes(String(row['Status']))
    );
    const now = new Date();
    if (!claim) {
      const claimId = nextId_(claims, 'Claim ID', 'CL');
      appendObjectRow_(claims, {
        'Claim ID': claimId, 'Set ID': setId, 'Buyer Name': request.buyer_name || '',
        'Telegram Username': request.username ? `@${String(request.username).replace(/^@/, '')}` : '',
        'Telegram User ID': String(request.telegram_user_id), 'Quantity': 0,
        'Submitted': now, 'Last Edited': now, 'Status': 'Submitted',
      });
      claim = records_(CLAIMS_SHEET).find(row => String(row['Claim ID']) === claimId);
    }

    const existing = records_(CLAIM_ITEMS_SHEET).find(row =>
      String(row['Claim ID']) === String(claim['Claim ID']) &&
      String(row['Card ID']) === String(request.card_id)
    );
    if (existing) {
      if (String(existing['Allocation']) === 'Pending') return claimSummary_(claim['Claim ID']);
      const match = findRow_(items, 'Claim ID', claim['Claim ID']);
      const allItems = items.getDataRange().getValues();
      const headers = headerMap_(allItems[0]);
      for (let index = 1; index < allItems.length; index++) {
        if (String(allItems[index][requiredColumn_(headers, 'Claim ID')]) === String(claim['Claim ID']) &&
            String(allItems[index][requiredColumn_(headers, 'Card ID')]) === String(request.card_id)) {
          setCellByHeader_(items, headers, index + 1, 'Allocation', 'Pending');
          break;
        }
      }
    } else {
      appendObjectRow_(items, {
        'Claim ID': claim['Claim ID'], 'Set ID': setId,
        'Card ID': request.card_id, 'Allocation': 'Pending',
      });
    }
    refreshClaim_(claim['Claim ID'], 'Submitted');
    SpreadsheetApp.flush();
    return claimSummary_(claim['Claim ID']);
  } finally {
    lock.releaseLock();
  }
}

function removeClaimItem_(request) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const claim = records_(CLAIMS_SHEET).find(row =>
      String(row['Claim ID']) === String(request.claim_id) &&
      String(row['Telegram User ID']) === String(request.telegram_user_id)
    );
    if (!claim) throw new Error('Claim not found.');
    if (!isSetOpen_(findSet_(claim['Set ID']))) throw new Error('This claim can no longer be edited.');
    const items = getSpreadsheet_().getSheetByName(CLAIM_ITEMS_SHEET);
    const values = items.getDataRange().getValues();
    const headers = headerMap_(values[0]);
    let changed = false;
    for (let index = 1; index < values.length; index++) {
      if (String(values[index][requiredColumn_(headers, 'Claim ID')]) === String(request.claim_id) &&
          String(values[index][requiredColumn_(headers, 'Card ID')]) === String(request.card_id) &&
          String(values[index][requiredColumn_(headers, 'Allocation')]) === 'Pending') {
        setCellByHeader_(items, headers, index + 1, 'Allocation', 'Withdrawn');
        changed = true;
      }
    }
    if (!changed) throw new Error('Claim item not found or no longer editable.');
    refreshClaim_(request.claim_id, 'Submitted');
    return claimSummary_(request.claim_id);
  } finally {
    lock.releaseLock();
  }
}

function refreshClaim_(claimId, status) {
  const claims = getSpreadsheet_().getSheetByName(CLAIMS_SHEET);
  const match = findRow_(claims, 'Claim ID', claimId);
  if (!match) return;
  const quantity = records_(CLAIM_ITEMS_SHEET).filter(row =>
    String(row['Claim ID']) === String(claimId) && String(row['Allocation']) === 'Pending'
  ).length;
  setCellByHeader_(claims, match.headers, match.row, 'Quantity', quantity);
  setCellByHeader_(claims, match.headers, match.row, 'Last Edited', new Date());
  setCellByHeader_(claims, match.headers, match.row, 'Status', quantity ? status : 'Cancelled');
}

function claimSummary_(claimId) {
  const claim = records_(CLAIMS_SHEET).find(row => String(row['Claim ID']) === String(claimId));
  if (!claim) return null;
  const set = findSet_(claim['Set ID']) || {};
  const items = records_(CLAIM_ITEMS_SHEET).filter(row => String(row['Claim ID']) === String(claimId));
  return {
    claim_id: String(claim['Claim ID']), set_id: String(claim['Set ID']),
    set_name: String(set['Set Name'] || ''), quantity: number_(claim['Quantity']),
    status: String(claim['Status'] || ''), set_status: String(set['Status'] || ''),
    claim_closes: serialiseValue_(set['Claim Closes']),
    items: items.filter(item => String(item['Allocation']) !== 'Withdrawn').map(item => ({
      card_id: String(item['Card ID']), allocation: String(item['Allocation'] || ''),
    })),
  };
}

function listClaims_(telegramUserId) {
  if (!telegramUserId) throw new Error('Telegram User ID is required.');
  return records_(CLAIMS_SHEET)
    .filter(row => String(row['Telegram User ID']) === String(telegramUserId))
    .map(row => claimSummary_(row['Claim ID'])).filter(Boolean).reverse();
}

function allocateSet_(setId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const set = findSet_(setId);
    if (!set) throw new Error('Set not found.');
    if (String(set['Sale Mode']) !== 'Priority') throw new Error('This is not a priority set.');
    const setsSheet = getSpreadsheet_().getSheetByName(SETS_SHEET);
    const match = findRow_(setsSheet, 'Set ID', setId);
    setCellByHeader_(setsSheet, match.headers, match.row, 'Status', 'Claims Closed');
    return allocateSetCore_(setId);
  } finally {
    lock.releaseLock();
  }
}

function allocateSetCore_(setId) {
  const ss = getSpreadsheet_();
  const inventory = ss.getSheetByName(INVENTORY_SHEET);
  const claimItems = ss.getSheetByName(CLAIM_ITEMS_SHEET);
  const claimsSheet = ss.getSheetByName(CLAIMS_SHEET);
  const available = new Set(records_(INVENTORY_SHEET)
    .filter(row => String(row['Set ID']) === String(setId) && String(row['Status']) === 'Available')
    .map(row => String(row['Card ID'])));
  const claims = records_(CLAIMS_SHEET).filter(row =>
    String(row['Set ID']) === String(setId) &&
    !['Forfeited', 'Cancelled'].includes(String(row['Status']))
  );
  const pendingItems = records_(CLAIM_ITEMS_SHEET).filter(row =>
    String(row['Set ID']) === String(setId) && String(row['Allocation']) === 'Pending'
  );
  const claimItemMap = {};
  pendingItems.forEach(item => {
    const claimId = String(item['Claim ID']);
    if (!claimItemMap[claimId]) claimItemMap[claimId] = [];
    claimItemMap[claimId].push(String(item['Card ID']));
  });
  const unprocessed = new Set(claims.map(row => String(row['Claim ID'])));
  const allocations = [];

  while (available.size && unprocessed.size) {
    const candidates = claims.filter(row => unprocessed.has(String(row['Claim ID']))).map(row => {
      const cards = (claimItemMap[String(row['Claim ID'])] || []).filter(cardId => available.has(cardId));
      return {claim: row, cards: cards, count: cards.length};
    }).filter(candidate => candidate.count > 0);
    if (!candidates.length) break;
    candidates.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      const aTime = dateValue_(a.claim['Last Edited']) || new Date(8640000000000000);
      const bTime = dateValue_(b.claim['Last Edited']) || new Date(8640000000000000);
      if (aTime.getTime() !== bTime.getTime()) return aTime - bTime;
      return String(a.claim['Claim ID']).localeCompare(String(b.claim['Claim ID']));
    });
    const winner = candidates[0];
    const claimId = String(winner.claim['Claim ID']);
    winner.cards.forEach(cardId => {
      available.delete(cardId);
      setClaimItemAllocation_(claimItems, claimId, cardId, 'Won');
      const card = findRow_(inventory, 'Card ID', cardId);
      setCellByHeader_(inventory, card.headers, card.row, 'Status', 'Allocated');
      setCellByHeader_(inventory, card.headers, card.row, 'Allocated Buyer', winner.claim['Telegram Username'] || winner.claim['Buyer Name']);
      setCellByHeader_(inventory, card.headers, card.row, 'Allocated Telegram User ID', String(winner.claim['Telegram User ID']));
      setCellByHeader_(inventory, card.headers, card.row, 'Winning Claim ID', claimId);
    });
    allocations.push({
      claim_id: claimId, telegram_user_id: String(winner.claim['Telegram User ID']),
      buyer_name: String(winner.claim['Buyer Name'] || ''), card_ids: winner.cards,
      set_id: String(setId),
    });
    unprocessed.delete(claimId);
  }

  const allocatedCardIds = new Set(records_(INVENTORY_SHEET)
    .filter(row => String(row['Set ID']) === String(setId) && String(row['Status']) === 'Allocated')
    .map(row => String(row['Card ID'])));
  records_(CLAIM_ITEMS_SHEET).filter(row =>
    String(row['Set ID']) === String(setId) && String(row['Allocation']) === 'Pending'
  ).forEach(item => {
    if (allocatedCardIds.has(String(item['Card ID']))) {
      setClaimItemAllocation_(claimItems, item['Claim ID'], item['Card ID'], 'Lost');
    }
  });
  claims.forEach(claim => {
    const summary = claimSummary_(claim['Claim ID']);
    const won = summary.items.some(item => item.allocation === 'Won');
    const match = findRow_(claimsSheet, 'Claim ID', claim['Claim ID']);
    setCellByHeader_(claimsSheet, match.headers, match.row, 'Status', won ? 'Allocated' : 'Unsuccessful');
  });
  const setsSheet = ss.getSheetByName(SETS_SHEET);
  const setMatch = findRow_(setsSheet, 'Set ID', setId);
  setCellByHeader_(setsSheet, setMatch.headers, setMatch.row, 'Status', 'Allocated');
  SpreadsheetApp.flush();
  return {set_id: String(setId), allocations: allocations};
}

function setClaimItemAllocation_(sheet, claimId, cardId, value) {
  const rows = sheet.getDataRange().getValues();
  const headers = headerMap_(rows[0]);
  for (let index = 1; index < rows.length; index++) {
    if (String(rows[index][requiredColumn_(headers, 'Claim ID')]) === String(claimId) &&
        String(rows[index][requiredColumn_(headers, 'Card ID')]) === String(cardId)) {
      setCellByHeader_(sheet, headers, index + 1, 'Allocation', value);
      return;
    }
  }
}

function allocationPreview_(setId, telegramUserId) {
  const cards = records_(INVENTORY_SHEET).filter(row =>
    String(row['Set ID']) === String(setId) && String(row['Status']) === 'Allocated' &&
    String(row['Allocated Telegram User ID']) === String(telegramUserId)
  );
  if (!cards.length) return null;
  return {
    set_id: String(setId), set_name: String((findSet_(setId) || {})['Set Name'] || ''),
    subtotal: cards.reduce((sum, row) => sum + number_(row['Selling Price']), 0),
    cards: cards.map(row => ({card_id: String(row['Card ID']), price: number_(row['Selling Price'])})),
  };
}

function requeuePriorityCards_(setId, cardIds, forfeitingUserId) {
  const claimsSheet = getSpreadsheet_().getSheetByName(CLAIMS_SHEET);
  const itemsSheet = getSpreadsheet_().getSheetByName(CLAIM_ITEMS_SHEET);
  const wanted = new Set(cardIds.map(String));
  records_(CLAIMS_SHEET).filter(row =>
    String(row['Set ID']) === String(setId) &&
    String(row['Telegram User ID']) === String(forfeitingUserId)
  ).forEach(claim => {
    const match = findRow_(claimsSheet, 'Claim ID', claim['Claim ID']);
    setCellByHeader_(claimsSheet, match.headers, match.row, 'Status', 'Forfeited');
  });
  const values = itemsSheet.getDataRange().getValues();
  const headers = headerMap_(values[0]);
  const claimRows = records_(CLAIMS_SHEET);
  const forfeited = new Set(claimRows.filter(row => String(row['Status']) === 'Forfeited').map(row => String(row['Claim ID'])));
  for (let index = 1; index < values.length; index++) {
    const cardId = String(values[index][requiredColumn_(headers, 'Card ID')]);
    if (!wanted.has(cardId)) continue;
    const claimId = String(values[index][requiredColumn_(headers, 'Claim ID')]);
    setCellByHeader_(itemsSheet, headers, index + 1, 'Allocation', forfeited.has(claimId) ? 'Forfeited' : 'Pending');
  }
  return allocateSetCore_(setId).allocations;
}
