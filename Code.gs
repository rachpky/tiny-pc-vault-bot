const SPREADSHEET_ID = '1IXw1B2Tfo9gxBt4NkRv7xCx2nJYTkDeAwtxEYeafhMQ';
const INVENTORY_SHEET = 'Inventory';
const ORDERS_SHEET = 'Orders';
const ORDER_ITEMS_SHEET = 'Order Items';
const SETS_SHEET = 'Sets';
const CLAIMS_SHEET = 'Claims';
const CLAIM_ITEMS_SHEET = 'Claim Items';
const HOLD_MINUTES = 10;

function doGet() {
  return jsonResponse_({ok: true, data: {service: 'photocard-shop-api-v3'}});
}

function doPost(e) {
  try {
    const request = JSON.parse((e.postData && e.postData.contents) || '{}');
    verifySecret_(request.secret);
    const routes = {
      list_inventory: () => listInventory_(request.member || ''),
      get_card: () => getCard_(request.card_id),
      set_card_photo: () => setCardPhoto_(request.card_id, request.telegram_file_id),
      hold_card: () => holdCard_(request.card_id, request.telegram_user_id),
      list_holds: () => listHolds_(request.telegram_user_id),
      release_holds: () => releaseHolds_(request.card_ids || [], request.telegram_user_id),
      create_order: () => createOrder_(request),
      list_orders: () => listOrders_(request.telegram_user_id),
      cancel_order: () => cancelOrder_(request.order_id, request.telegram_user_id),
      add_claim_item: () => addClaimItem_(request),
      remove_claim_item: () => removeClaimItem_(request),
      list_claims: () => listClaims_(request.telegram_user_id),
      list_sets: () => listSets_(),
      allocate_set: () => allocateSet_(request.set_id),
      allocation_preview: () => allocationPreview_(request.set_id, request.telegram_user_id),
      create_allocation_order: () => createAllocationOrder_(request),
    };
    if (!routes[request.action]) throw new Error('Unknown API action.');
    return jsonResponse_({ok: true, data: routes[request.action]()});
  } catch (error) {
    console.error(error.stack || error);
    return jsonResponse_({ok: false, error: error.message || String(error)});
  }
}

/** Run once from Apps Script before deploying the web app. */
function setupShopApi() {
  const ss = getSpreadsheet_();
  addMissingColumns_(ss.getSheetByName(INVENTORY_SHEET), [
    'Set ID', 'Sale Mode', 'Telegram File ID', 'Held By', 'Held Until',
    'Allocated Buyer', 'Allocated Telegram User ID', 'Winning Claim ID',
  ]);
  addMissingColumns_(ss.getSheetByName(ORDERS_SHEET), [
    'Telegram User ID', 'Order Source', 'Set ID',
  ]);
  ensureSheet_(ss, SETS_SHEET, [
    'Set ID', 'Set Name', 'Claim Opens', 'Claim Closes', 'Sale Mode', 'Status',
  ]);
  ensureSheet_(ss, CLAIMS_SHEET, [
    'Claim ID', 'Set ID', 'Buyer Name', 'Telegram Username', 'Telegram User ID',
    'Quantity', 'Submitted', 'Last Edited', 'Status',
  ]);
  ensureSheet_(ss, CLAIM_ITEMS_SHEET, [
    'Claim ID', 'Set ID', 'Card ID', 'Allocation',
  ]);
  SpreadsheetApp.flush();
}

function verifySecret_(provided) {
  const expected = PropertiesService.getScriptProperties().getProperty('SHOP_API_SECRET');
  if (!expected) throw new Error('SHOP_API_SECRET is not configured in Apps Script.');
  if (!provided || provided !== expected) throw new Error('Unauthorised request.');
}
