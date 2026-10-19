// Runtime substitution for `react-native` on web.
//
// The shared app is typechecked against the real react-native types; at bundle
// time react-native-web is the implementation (see vite.config.ts alias).
// react-native-web stubs out a few APIs the app depends on:
//   - Alert.alert() is literally `static alert() {}` — every confirmation
//     dialog would silently do nothing, so we render a real DOM dialog and
//     wire button onPress callbacks.
//   - Share.share() rejects in browsers without navigator.share (all desktops
//     except macOS Safari/Chrome) — fall back to the clipboard.
//   - Keyboard.addListener() never fires — emulate show/hide from
//     visualViewport so KeyboardSafe/BatchWizard keep working.
//   - BackHandler is a stub — provide a safe no-op with the RN shape.
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import * as RNW from "react-native-web";

// @ts-ignore -- react-native-web ships no bundled types; runtime-only shim.
export * from "react-native-web";

/* ─────────────────────── TextInput paint fix ─────────────────────── */
// RNW renders Text with `position: relative` but TextInput as a static
// <input>. An absolutely-positioned sibling — e.g. expo-blur's BlurView
// filling a frosted card — paints on top of every static in-flow element,
// and its `backdrop-filter` blurs them (Text elements sit above it and stay
// sharp; the inputs go fuzzy). Positioning inputs puts them in the same
// paint layer as the surrounding Text. Caller styles still win (applied
// after), so absolutely-positioned inputs keep working.
const POSITION_RELATIVE = { position: "relative" } as const;

export const TextInput = React.forwardRef<unknown, any>(function TextInput(props, ref) {
  const { style, ...rest } = props;
  return <RNW.TextInput {...rest} ref={ref as any} style={[POSITION_RELATIVE, style]} />;
});

/* ───────────────────────── Alert ───────────────────────── */

type AlertButtonStyle = "default" | "cancel" | "destructive";

export type AlertButton = {
  text?: string;
  onPress?: (value?: string) => void;
  style?: AlertButtonStyle;
};

export type AlertOptions = {
  cancelable?: boolean;
  onDismiss?: () => void;
};

type AlertJob = {
  title: string;
  message?: string;
  buttons?: AlertButton[];
  options?: AlertOptions;
};

const alertQueue: AlertJob[] = [];
let alertCurrent: AlertJob | null = null;
let alertHost: HTMLDivElement | null = null;
let alertRoot: Root | null = null;

const alertCss = `
.jsh-alert-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;
  background:rgba(10,8,4,0.45);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);padding:24px}
.jsh-alert-card{width:100%;max-width:344px;border-radius:20px;overflow:hidden;
  background:#ffffff;border:0.5px solid rgba(22,19,12,0.14);box-shadow:0 24px 64px rgba(0,0,0,0.35);
  animation:jsh-alert-in .18s cubic-bezier(.2,.9,.3,1)}
@keyframes jsh-alert-in{from{opacity:0;transform:scale(.94) translateY(6px)}to{opacity:1;transform:none}}
.jsh-alert-body{padding:20px 18px 16px;text-align:center}
.jsh-alert-title{font-family:"Inter_700Bold",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  font-size:16px;line-height:21px;color:#16130c;letter-spacing:-0.3px;margin:0}
.jsh-alert-msg{font-family:"Inter_400Regular",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  font-size:13.5px;line-height:19px;color:#837b69;margin:7px 0 0}
.jsh-alert-btns{display:flex;flex-direction:column;border-top:0.5px solid rgba(22,19,12,0.14)}
.jsh-alert-btn{appearance:none;-webkit-appearance:none;border:0;background:transparent;cursor:pointer;width:100%;
  padding:13px 16px;font-size:14.5px;text-align:center;letter-spacing:-0.2px;
  font-family:"Inter_500Medium",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#16130c}
.jsh-alert-btn:not(:first-child){border-top:0.5px solid rgba(22,19,12,0.14)}
.jsh-alert-btn:hover{background:rgba(22,19,12,0.05)}
.jsh-alert-btn:active{background:rgba(22,19,12,0.09)}
.jsh-alert-btn-default{font-family:"Inter_600SemiBold",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#ff4d00}
.jsh-alert-btn-destructive{font-family:"Inter_600SemiBold",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#c0392b}
.jsh-alert-btn-cancel{color:#837b69}
@media (prefers-color-scheme: dark){
  .jsh-alert-card{background:#211d14;border-color:rgba(246,241,228,0.16)}
  .jsh-alert-title{color:#f6f1e4}
  .jsh-alert-msg{color:#a89f88}
  .jsh-alert-btns{background:#2a2519}
  .jsh-alert-btn{color:#f6f1e4}
  .jsh-alert-btn-default{color:#ff4d00}
  .jsh-alert-btn-destructive{color:#e06c5b}
  .jsh-alert-btn-cancel{color:#a89f88}
  .jsh-alert-btn:not(:first-child){border-top-color:rgba(246,241,228,0.14)}
  .jsh-alert-btn:hover{background:rgba(246,241,228,0.06)}
}
`;

function ensureAlertHost(): void {
  if (alertHost && document.body.contains(alertHost)) return;
  const style = document.createElement("style");
  style.textContent = alertCss;
  document.head.appendChild(style);
  alertHost = document.createElement("div");
  alertHost.id = "jsh-alert-host";
  document.body.appendChild(alertHost);
  alertRoot = createRoot(alertHost);
}

function nextAlert(): void {
  alertCurrent = alertQueue.shift() ?? null;
  if (!alertCurrent) {
    alertRoot?.render(null);
    return;
  }
  alertRoot!.render(
    React.createElement(AlertDialog, {
      job: alertCurrent,
      onPressButton: (button: AlertButton | null) => {
        const job = alertCurrent;
        alertCurrent = null;
        if (button) {
          setTimeout(() => {
            try {
              button.onPress?.();
            } catch {
              /* user callback must never break the dialog queue */
            }
          }, 0);
        } else {
          job?.options?.onDismiss?.();
        }
        nextAlert();
      },
    })
  );
}

function AlertDialog({
  job,
  onPressButton,
}: {
  job: AlertJob;
  onPressButton: (button: AlertButton | null) => void;
}): React.ReactElement {
  const buttons: AlertButton[] =
    job.buttons && job.buttons.length > 0 ? job.buttons : [{ text: "OK", style: "default" }];
  const cancelButton = buttons.find((b) => b.style === "cancel") ?? null;
  const canBackdropDismiss = cancelButton !== null || job.options?.cancelable === true;

  return React.createElement(
    "div",
    {
      className: "jsh-alert-overlay",
      onMouseDown: (e: React.MouseEvent) => {
        if (e.target === e.currentTarget && canBackdropDismiss) {
          onPressButton(cancelButton);
        }
      },
    },
    React.createElement(
      "div",
      { className: "jsh-alert-card", role: "alertdialog", "aria-modal": true },
      React.createElement(
        "div",
        { className: "jsh-alert-body" },
        React.createElement("p", { className: "jsh-alert-title" }, job.title),
        job.message ? React.createElement("p", { className: "jsh-alert-msg" }, job.message) : null
      ),
      React.createElement(
        "div",
        { className: "jsh-alert-btns" },
        buttons.map((button, i) =>
          React.createElement(
            "button",
            {
              // eslint-disable-next-line react/no-array-index-key
              key: i,
              type: "button",
              className: `jsh-alert-btn jsh-alert-btn-${button.style ?? "default"}`,
              onClick: () => onPressButton(button),
            },
            button.text ?? "OK"
          )
        )
      )
    )
  );
}

class AlertShim {
  static alert(
    title: string,
    message?: string,
    buttons?: AlertButton[],
    options?: AlertOptions
  ): void {
    ensureAlertHost();
    alertQueue.push({ title, message, buttons, options });
    if (!alertCurrent) nextAlert();
  }

  static prompt(): void {
    // iOS-only RN API; not used by the shared app.
  }
}

export const Alert = AlertShim;

/* ───────────────────────── Share ───────────────────────── */

export type ShareContent = { title?: string; message?: string; url?: string; type?: string };
export type ShareOptions = { dialogTitle?: string; excludedActivityTypes?: unknown; tintColor?: unknown };
export type ShareAction = "sharedAction" | "dismissedAction";
export type ShareSharedAction = { action: "sharedAction"; activityType?: string | null };
export type ShareDismissedAction = { action: "dismissedAction" };

class ShareShim {
  static sharedAction: "sharedAction" = "sharedAction";
  static dismissedAction: "dismissedAction" = "dismissedAction";

  static async share(
    content: ShareContent,
    _options?: ShareOptions
  ): Promise<ShareSharedAction | ShareDismissedAction> {
    if (content == null || (content.url == null && content.message == null)) {
      throw new Error("Share content must include a message or url");
    }
    const nav = window.navigator as Navigator & { share?: (data: unknown) => Promise<void> };
    if (typeof nav.share === "function") {
      try {
        await nav.share({
          title: content.title,
          text: content.message,
          url: content.url,
        });
        return { action: "sharedAction" };
      } catch (error: unknown) {
        if ((error as { name?: string })?.name === "AbortError") {
          return { action: "dismissedAction" };
        }
        // fall through to clipboard fallback
      }
    }
    const payload = [content.message, content.url].filter(Boolean).join("\n") || content.title || "";
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
        return { action: "sharedAction" };
      }
    } catch {
      /* clipboard denied */
    }
    throw new Error("Share is not supported in this browser");
  }
}

export const Share = ShareShim;

/* ───────────────────────── BackHandler ───────────────────────── */

type BackPressEvent = { preventDefault: () => void };

export const BackHandler = {
  exitApp(): void {},
  addEventListener(_eventName: "hardwareBackPress", _handler: () => boolean | null | undefined) {
    return { remove(): void {} };
  },
  removeEventListener(_eventName: "hardwareBackPress", _handler: () => boolean | null | undefined): void {},
};

/* ───────────────────────── Keyboard ───────────────────────── */

export type KeyboardEventName =
  | "keyboardWillShow"
  | "keyboardDidShow"
  | "keyboardWillHide"
  | "keyboardDidHide"
  | "keyboardWillChangeFrame"
  | "keyboardDidChangeFrame";

export type KeyboardEvent = {
  duration: number;
  easing: string;
  endCoordinates: { height: number; screenX: number; screenY: number; width: number };
};

type KeyboardListener = (event: KeyboardEvent) => void;

const keyboardListeners = new Map<string, Set<KeyboardListener>>();
let keyboardVisible = false;
let keyboardAttached = false;

function keyboardMetrics() {
  const vv = window.visualViewport;
  const viewportHeight = vv ? vv.height : window.innerHeight;
  const offsetTop = vv ? vv.offsetTop : 0;
  const height = Math.max(0, window.innerHeight - viewportHeight - offsetTop);
  return { height, width: vv ? vv.width : window.innerWidth, offsetTop };
}

function isEditableFocused(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function emitKeyboardEvent(event: string, metrics: { height: number; width: number; offsetTop: number }): void {
  const listeners = keyboardListeners.get(event);
  if (!listeners || listeners.size === 0) return;
  const payload: KeyboardEvent = {
    duration: 0,
    easing: "keyboard",
    endCoordinates: {
      height: metrics.height,
      screenX: 0,
      screenY: window.innerHeight - metrics.height,
      width: metrics.width,
    },
  };
  listeners.forEach((listener) => {
    try {
      listener(payload);
    } catch {
      /* a listener must never break the emitter */
    }
  });
}

function handleKeyboardChange(reason: "show" | "hide"): void {
  const metrics = keyboardMetrics();
  const visible = isEditableFocused() && metrics.height > 80;
  if (visible === keyboardVisible) return;
  keyboardVisible = visible;
  const name = visible ? "Show" : "Hide";
  emitKeyboardEvent(`keyboardWill${name}`, metrics);
  emitKeyboardEvent(`keyboardWillChangeFrame`, metrics);
  setTimeout(() => {
    emitKeyboardEvent(`keyboardDid${name}`, visible ? keyboardMetrics() : metrics);
    emitKeyboardEvent(`keyboardDidChangeFrame`, metrics);
  }, 0);
}

function attachKeyboardObservers(): void {
  if (keyboardAttached || typeof window === "undefined") return;
  keyboardAttached = true;
  const vv = window.visualViewport;
  if (vv) {
    vv.addEventListener("resize", () => handleKeyboardChange(keyboardVisible ? "hide" : "show"));
    vv.addEventListener("scroll", () => handleKeyboardChange(keyboardVisible ? "hide" : "show"));
  }
  window.addEventListener("resize", () => handleKeyboardChange(keyboardVisible ? "hide" : "show"));
  document.addEventListener("focusin", () => setTimeout(() => handleKeyboardChange("show"), 50));
  document.addEventListener("focusout", () => setTimeout(() => handleKeyboardChange("hide"), 50));
  // Defensive: some browsers never resize the visual viewport for on-screen
  // keyboards. Also treat blur of the last editable as a hide signal.
  document.addEventListener("selectionchange", () => {
    if (!isEditableFocused() && keyboardVisible) handleKeyboardChange("hide");
  });
}

class KeyboardShim {
  static addListener(eventName: string, listener: KeyboardListener) {
    attachKeyboardObservers();
    const set = keyboardListeners.get(eventName) ?? new Set<KeyboardListener>();
    set.add(listener);
    keyboardListeners.set(eventName, set);
    return {
      remove(): void {
        set.delete(listener);
      },
    };
  }

  static removeListener(eventName: string, listener: KeyboardListener): void {
    keyboardListeners.get(eventName)?.delete(listener);
  }

  static removeAllListeners(eventName?: string): void {
    if (eventName) keyboardListeners.delete(eventName);
    else keyboardListeners.clear();
  }

  static dismiss(): void {
    const el = document.activeElement as HTMLElement | null;
    el?.blur?.();
  }

  static isVisible(): boolean {
    return keyboardVisible;
  }

  static metrics(): { height: number; screenX: number; screenY: number; width: number } | undefined {
    if (!keyboardVisible) return undefined;
    const { height, width } = keyboardMetrics();
    return { height, screenX: 0, screenY: window.innerHeight - height, width };
  }
}

export const Keyboard = KeyboardShim;

// Silence unused warnings for re-exported RNW while keeping startup side
// effects minimal.
void RNW;
