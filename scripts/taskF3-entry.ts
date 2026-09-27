/**
 * taskF3 entry — the REAL Update Center pipeline under the electron stub:
 * fetchLatestTag (live GitHub), updateCenterCheck/List/Entry, and
 * runUpdatePipeline (download -> extract -> VERIFY by RUNNING the binary
 * -> atomic APPLY with .bak).
 */
export {
  fetchLatestTag,
  runUpdatePipeline,
  updateCenterCheck,
  updateCenterEntry,
  updateCenterList,
  updateCenterRollback,
  updatesDirFor,
  type UpdateCore,
  type CoreUpdateEntry,
} from "../electron-app/electron/updateCenter";
