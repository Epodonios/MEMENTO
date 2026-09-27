/**
 * taskF1 entry — bundles the REAL installerCore (setup-app) + the REAL
 * uninstall module (electron-app) under the electron stub so the smoke
 * can drive the FULL install pipeline on any OS.
 *
 * The installerCore is electron-free by design; uninstall.ts is
 * electron-free too (pure plan builders). They are bundled together to
 * prove the setup<->MEMENTO contract (UninstallString flag, ARP fields,
 * preserved dirs) matches exactly.
 */
export {
  computeManifest,
  validateDestPath,
  freeDiskBytes,
  runInstall,
  buildUninstallPlan,
  nowStamp,
} from "../setup-app/electron/installerCore";

export {
  UNINSTALL_FLAG,
  isUninstallInvocation,
  isQuietUninstall,
  buildPlan,
  defaultInstallDir,
  selfDeleteCommand,
  otherMementoPids,
  terminateCommand,
} from "../electron-app/electron/uninstall";
