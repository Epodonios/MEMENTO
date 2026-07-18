/**
 * Browser notification & sound utilities.
 * Used across PingerTab, ScannerTab, and ConfigsTab for
 * consistent "task complete" feedback.
 */

/** Play a short chime via Web Audio API (no asset files needed). */
export function playNotificationSound() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    // Three ascending notes: C5 → E5 → G5
    const notes = [523.25, 659.25, 783.99];

    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;

      gain.gain.setValueAtTime(0, now + i * 0.12);
      gain.gain.linearRampToValueAtTime(0.18, now + i * 0.12 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.18);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.2);
    });
  } catch {
    /* Audio not available — silent fallback */
  }
}

/** Show a browser notification (requires user permission). */
export function showBrowserNotification(title: string, body: string) {
  try {
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") {
      new Notification(title, { body, silent: false });
    } else if (Notification.permission !== "denied") {
      Notification.requestPermission().then(perm => {
        if (perm === "granted") {
          new Notification(title, { body });
        }
      });
    }
  } catch {
    /* Notification API not available */
  }
}
