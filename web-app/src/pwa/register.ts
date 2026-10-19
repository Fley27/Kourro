// Service worker registration + update flow (registerType: "prompt").
// The update banner lives in UpdatePrompt; this module owns the SW handle so
// "Rafrechi" can swap in the new build without a manual reload dance.
import { registerSW } from "virtual:pwa-register";

type UpdateListener = () => void;

const listeners = new Set<UpdateListener>();
let updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null;
let updateReady = false;

export function onPwaUpdate(listener: UpdateListener): () => void {
  listeners.add(listener);
  if (updateReady) listener();
  return () => {
    listeners.delete(listener);
  };
}

export function applyPwaUpdate(): void {
  void updateSW?.(true);
}

export function initPwa(): void {
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      updateReady = true;
      listeners.forEach((listener) => {
        try {
          listener();
        } catch {
          /* a listener must never break SW handling */
        }
      });
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      const check = () => {
        registration.update().catch(() => {});
      };
      // Long-lived desktop sessions: poll while visible so the "new version"
      // prompt shows up without a hard refresh.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") check();
      });
      window.setInterval(check, 30 * 60 * 1000);
    },
  });
}
