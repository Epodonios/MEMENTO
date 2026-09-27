// Phase D3 functional-test entry — re-exports the REAL modules (no store).
export { collectBackup, parseBackup, applyBackup, backupFileName, BACKUP_FORMAT, BACKUP_VERSION, BACKUP_KEYS } from "../src/utils/appBackup";
export { makeQrDataUrl, qrPayloadToLinks } from "../src/utils/qrShare";
