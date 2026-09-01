function getSpreadsheet_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function records_(sheetName) {
  const sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) throw new Error(`Missing sheet: ${sheetName}`);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(String);
  return values.slice(1).map((row, index) => {
    const record = {_row: index + 2};
    headers.forEach((header, column) => record[header] = row[column]);
    return record;
  });
}

function headerMap_(headers) {
  const map = {};
  headers.forEach((header, index) => map[String(header).trim()] = index);
  return map;
}

function requiredColumn_(headers, name) {
  if (!(name in headers)) throw new Error(`Missing required column: ${name}`);
  return headers[name];
}

function appendObjectRow_(sheet, valuesByHeader) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  sheet.appendRow(headers.map(header => valuesByHeader[header] !== undefined ? valuesByHeader[header] : ''));
}

function setCellByHeader_(sheet, headers, row, header, value) {
  if (header in headers) sheet.getRange(row, headers[header] + 1).setValue(value);
}

function addMissingColumns_(sheet, columns) {
  if (!sheet) throw new Error('A required sheet is missing.');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  columns.forEach(column => {
    if (!headers.includes(column)) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(column).setFontWeight('bold');
      headers.push(column);
    }
  });
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else {
    addMissingColumns_(sheet, headers);
  }
  return sheet;
}

function nextId_(sheet, header, prefix) {
  const values = sheet.getDataRange().getValues();
  if (!values.length) return `${prefix}-0001`;
  const headers = headerMap_(values[0]);
  const idCol = requiredColumn_(headers, header);
  let highest = 0;
  values.slice(1).forEach(row => {
    const match = String(row[idCol] || '').match(new RegExp(`^${prefix}-(\\d+)$`, 'i'));
    if (match) highest = Math.max(highest, Number(match[1]));
  });
  return `${prefix}-${String(highest + 1).padStart(4, '0')}`;
}

function number_(value) {
  if (typeof value === 'number') return value;
  const parsed = Number(String(value || '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateValue_(value) {
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function serialiseValue_(value) {
  return value instanceof Date ? value.toISOString() : String(value || '');
}

function jsonResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function findRow_(sheet, header, wanted) {
  const values = sheet.getDataRange().getValues();
  if (!values.length) return null;
  const headers = headerMap_(values[0]);
  const column = requiredColumn_(headers, header);
  for (let index = 1; index < values.length; index++) {
    if (String(values[index][column]) === String(wanted)) {
      return {row: index + 1, values: values[index], headers: headers};
    }
  }
  return null;
}
