const SPREADSHEET_ID = '1mJWPsrnEk6bPPhcH40IfNQkV2AMOG8qYR4ko59gEPj8';
const SHEET_NAME = '15_SCAN_HEARTBEAT';
const TZ = 'Asia/Shanghai';
const SECRET_PROPERTY = 'HEARTBEAT_SECRET';

const EXPECTED_HEADERS = [
  'RunTime_BJT','ModelVersion','RunStatus','UniverseDenominator','BroadHits',
  'DeepCount','StickyChecked','PositionsChecked','DriveReadStatus','BinanceStatus',
  'SheetWritebackStatus','NotificationStatus','ErrorStage','ErrorDetail','ScoreVersion',
  'Source','Slot_BJT','Phase','C5Count','C3Count','C1Count','CFocusCount',
  'DLongCount','DShortCount','DFocusLongCount','DFocusShortCount',
  'SanityStrongTrendCount','SanityShortSqueezeCount','CandidatePipelineGap',
  'LatestClosed1h','LatestClosed15m','Cache15mFreshness','ACount','BCount',
  'SecondChanceCount','HeartbeatKey'
];

const ALLOWED_SOURCES = new Set(['VPS_FOCUS_V23']);
const ALLOWED_PHASES = new Set(['PRE_DEEP','FINAL','FALLBACK','FAILED']);
const ALLOWED_STATUSES = new Set([
  'READY','SUCCESS','PARTIAL','FAILED','FALLBACK_SUCCESS','FALLBACK_PARTIAL'
]);

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function nowBjt() {
  return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd HH:mm:ss 'BJT'");
}

function normalizeSlotBjt(value) {
  const s = String(value || '').trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2})(?::\d{2})?(?::\d{2})?(?:\s*BJT)?$/);
  if (!m) throw new Error('Slot_BJT must look like YYYY-MM-DD HH:00 BJT');
  const hour = Number(m[2]);
  if (hour < 0 || hour > 23) throw new Error('Invalid Slot_BJT hour');
  return `${m[1]} ${m[2]}:00 BJT`;
}

function makeHeartbeatKey(source, slotBjt, phase) {
  const m = slotBjt.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}):00 BJT$/);
  if (!m) throw new Error('Cannot derive HeartbeatKey from Slot_BJT');
  return `${source}|${m[1]}T${m[2]}|${phase}`;
}

function getSheetAndHeaders() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error(`Sheet not found: ${SHEET_NAME}`);

  const headers = sheet.getRange(1, 1, 1, EXPECTED_HEADERS.length)
    .getValues()[0].map(v => String(v || '').trim());

  for (let i = 0; i < EXPECTED_HEADERS.length; i++) {
    if (headers[i] !== EXPECTED_HEADERS[i]) {
      throw new Error(`Header mismatch at column ${i + 1}: expected "${EXPECTED_HEADERS[i]}", got "${headers[i]}"`);
    }
  }

  const headerMap = {};
  headers.forEach((h, i) => headerMap[h] = i);
  return { sheet, headers, headerMap };
}

function checkSecret(payload) {
  const expected = PropertiesService.getScriptProperties().getProperty(SECRET_PROPERTY);
  if (!expected) throw new Error('HEARTBEAT_SECRET is not configured');
  if (!payload || String(payload.secret || '') !== expected) throw new Error('AUTH_FAILED');
}

function doGet() {
  return jsonResponse({
    ok: true,
    service: 'trade-workbench-heartbeat-bridge',
    sheet: SHEET_NAME,
    timeZone: TZ,
    serverTime_BJT: nowBjt()
  });
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) throw new Error('EMPTY_BODY');
    const payload = JSON.parse(e.postData.contents);
    checkSecret(payload);

    const { sheet, headers, headerMap } = getSheetAndHeaders();

    if (payload.validate_only === true) {
      return jsonResponse({
        ok: true,
        mode: 'validate_only',
        spreadsheetId: SPREADSHEET_ID,
        sheet: SHEET_NAME,
        columns: headers.length,
        heartbeatKeyColumn: 'AJ',
        serverTime_BJT: nowBjt()
      });
    }

    const source = String(payload.Source || 'VPS_FOCUS_V23').trim();
    if (!ALLOWED_SOURCES.has(source)) throw new Error(`SOURCE_NOT_ALLOWED: ${source}`);

    const phase = String(payload.Phase || '').trim();
    if (!ALLOWED_PHASES.has(phase)) throw new Error(`PHASE_NOT_ALLOWED: ${phase}`);

    const runStatus = String(payload.RunStatus || '').trim();
    if (!ALLOWED_STATUSES.has(runStatus)) throw new Error(`RUN_STATUS_NOT_ALLOWED: ${runStatus}`);

    const slotBjt = normalizeSlotBjt(payload.Slot_BJT);
    const heartbeatKey = makeHeartbeatKey(source, slotBjt, phase);

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) throw new Error('LOCK_TIMEOUT');

    try {
      const lastRow = Math.max(sheet.getLastRow(), 1);
      let targetRow = null;

      if (lastRow >= 2) {
        const found = sheet
          .getRange(2, headerMap['HeartbeatKey'] + 1, lastRow - 1, 1)
          .createTextFinder(heartbeatKey).matchEntireCell(true).findNext();
        if (found) targetRow = found.getRow();
      }

      const isUpdate = targetRow !== null;
      if (!targetRow) targetRow = lastRow + 1;

      let rowValues = isUpdate
        ? sheet.getRange(targetRow, 1, 1, EXPECTED_HEADERS.length).getValues()[0]
        : new Array(EXPECTED_HEADERS.length).fill('');

      for (const header of EXPECTED_HEADERS) {
        if (Object.prototype.hasOwnProperty.call(payload, header)) {
          rowValues[headerMap[header]] = payload[header];
        }
      }

      rowValues[headerMap['RunTime_BJT']] = payload.RunTime_BJT || nowBjt();
      rowValues[headerMap['Source']] = source;
      rowValues[headerMap['Slot_BJT']] = slotBjt;
      rowValues[headerMap['Phase']] = phase;
      rowValues[headerMap['RunStatus']] = runStatus;
      rowValues[headerMap['HeartbeatKey']] = heartbeatKey;

      sheet.getRange(targetRow, 1, 1, EXPECTED_HEADERS.length).setValues([rowValues]);
      SpreadsheetApp.flush();

      const readBack = sheet.getRange(targetRow, 1, 1, EXPECTED_HEADERS.length).getValues()[0];
      if (String(readBack[headerMap['HeartbeatKey']]) !== heartbeatKey) {
        throw new Error('READBACK_KEY_MISMATCH');
      }

      return jsonResponse({
        ok: true,
        action: isUpdate ? 'UPDATE' : 'APPEND',
        row: targetRow,
        source, slotBjt, phase, runStatus, heartbeatKey,
        readBackVerified: true,
        serverTime_BJT: nowBjt()
      });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return jsonResponse({
      ok: false,
      error: String(err && err.message ? err.message : err),
      serverTime_BJT: nowBjt()
    });
  }
}
