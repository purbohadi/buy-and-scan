/**
 * Deploy as a Google Apps Script Web App (Execute as: Me, Who has access: Anyone).
 * Set SHEET_ID and optional WEBHOOK_SECRET (must match Worker secret in JSON body).
 */
const SHEET_ID = "YOUR_SPREADSHEET_ID";
const TAB_NAME = "Receipts";
const WEBHOOK_SECRET = ""; // optional; if set, Worker must POST { secret, row }

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const body = JSON.parse(e.postData.contents);
    if (WEBHOOK_SECRET && body.secret !== WEBHOOK_SECRET) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: "unauthorized" }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const row = body.row;
    if (!row || !Array.isArray(row)) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: "row required" }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const ss = SpreadsheetApp.openById(SHEET_ID);
    let sh = ss.getSheetByName(TAB_NAME);
    if (!sh) {
      sh = ss.insertSheet(TAB_NAME);
      sh.appendRow([
        "number",
        "id",
        "timestamp datetime",
        "location",
        "description AI summary",
        "category",
        "items detail",
        "total price",
        "currency",
        "image receipt url"
      ]);
    }
    sh.appendRow(row);
    return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) })).setMimeType(
      ContentService.MimeType.JSON
    );
  } finally {
    lock.releaseLock();
  }
}
