/**
 * MEMENTO — core routing coordinator (Task 11 dual-core, Task 12 triple-core).
 *
 * The generated config JSON itself decides the config-driven core: any
 * outbound with `type: "hysteria2" | "tuic"` runs on sing-box; everything
 * else keeps running on Xray byte-identically to the pre-Task-11 build.
 * The THIRD core (aether) is NOT config-driven — it is started explicitly
 * from the Aether tab via its own aether_start command and tracked through
 * the SAME active-core machinery below.
 *
 * This module tracks the ATTEMPTED core (so status/logs route to the right
 * manager even when a start FAILS — failure logs must reach the Logs tab)
 * and enforces "only one live core" when switching between any of the three.
 */
import { xrayManager } from "./xray";
import { singBoxManager } from "./singbox";
import { aetherManager } from "./aether";
import type { ConnectionStatus } from "./coreTypes";
import type { CoreKind } from "./coreTypes";

/**
 * Detects the core for a generated config. Best-effort: a config we cannot
 * parse routes to Xray (the safe default — the Xray manager then surfaces
 * the real parse/start error to the user).
 */
export function detectCoreFromConfigJson(configJson: string): CoreKind {
  try {
    const parsed = JSON.parse(configJson);
    const outbounds = parsed?.outbounds;
    if (Array.isArray(outbounds)) {
      for (const ob of outbounds) {
        if (ob?.type === "hysteria2" || ob?.type === "tuic") return "sing-box";
      }
    }
    return "xray";
  } catch {
    return "xray";
  }
}

let activeCore: CoreKind | null = null;

/** The core the LAST start attempt targeted (null before any attempt). */
export function getActiveCore(): CoreKind | null {
  return activeCore;
}

export function setActiveCore(core: CoreKind | null): void {
  activeCore = core;
}

/**
 * Stops the OTHER cores before a start — but ONLY the ones that actually
 * own a live child. An idle other-core is a no-op, so the same-core
 * reconnect path (connect → disconnect → connect again) stays byte-identical
 * to the pre-Task-11 behavior. Task 12: three-way, so a config start also
 * stops a live Aether session and an Aether start stops a live config
 * connection (only one core at any moment, in either direction).
 */
export function stopOtherCore(self: CoreKind): void {
  const others: CoreKind[] = (["xray", "sing-box", "aether"] as CoreKind[]).filter((k) => k !== self);
  for (const other of others) {
    if (other === "sing-box") {
      if (singBoxManager.hasLiveChild()) singBoxManager.stopSingBox();
    } else if (other === "aether") {
      if (aetherManager.hasLiveChild()) aetherManager.stopAether();
    } else {
      if (xrayManager.hasLiveChild()) xrayManager.stopXray();
    }
  }
}

/** App-shutdown cleanup for ALL THREE managers (main.ts cleanupOnce). */
export function cleanupAllCores(): void {
  xrayManager.cleanupOnExit();
  singBoxManager.cleanupOnExit();
  aetherManager.cleanupOnExit();
}

/** Convenience passthrough so ipc.ts can type against one shape. */
export type { ConnectionStatus };
