// Update banner: a small fixed bar (outside the RN tree) that appears when
// the service worker has a new build ready (see register.ts).
import React from "react";
import { createRoot } from "react-dom/client";
import { applyPwaUpdate, onPwaUpdate } from "./register";

const BANNER_CSS = `
.jsh-pwa-banner{position:fixed;top:0;left:0;right:0;z-index:2147483600;display:flex;align-items:center;gap:12px;
  padding:calc(10px + env(safe-area-inset-top)) 16px 10px;background:#16130c;color:#f6f1e4;
  font-family:"Inter_500Medium",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  box-shadow:0 8px 28px rgba(0,0,0,0.38);animation:jsh-pwa-in .28s cubic-bezier(.2,.9,.3,1)}
@keyframes jsh-pwa-in{from{opacity:0;transform:translateY(-100%)}to{opacity:1;transform:none}}
.jsh-pwa-banner-text{flex:1;min-width:0;font-size:13.5px;letter-spacing:-0.2px}
.jsh-pwa-banner-text strong{font-family:"Inter_700Bold",-apple-system,BlinkMacSystemFont,sans-serif}
.jsh-pwa-banner-btn{appearance:none;-webkit-appearance:none;border:0;cursor:pointer;border-radius:999px;
  padding:8px 16px;font-size:13px;font-family:"Inter_600SemiBold",-apple-system,BlinkMacSystemFont,sans-serif}
.jsh-pwa-banner-update{background:#ff4d00;color:#fff6ee}
.jsh-pwa-banner-update:hover{background:#ff641f}
.jsh-pwa-banner-later{background:transparent;color:#bdb39a}
.jsh-pwa-banner-later:hover{color:#f6f1e4}
`;

function PwaUpdateBanner(): React.ReactElement | null {
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => onPwaUpdate(() => setVisible(true)), []);

  if (!visible) return null;
  return React.createElement(
    "div",
    { className: "jsh-pwa-banner", role: "status" },
    React.createElement(
      "div",
      { className: "jsh-pwa-banner-text" },
      React.createElement("strong", null, "Nouvo vèsyon disponib."),
      " Rafrechi pou jwenn dènye mizajou yo."
    ),
    React.createElement(
      "button",
      {
        type: "button",
        className: "jsh-pwa-banner-btn jsh-pwa-banner-update",
        onClick: () => applyPwaUpdate(),
      },
      "Rafrechi"
    ),
    React.createElement(
      "button",
      {
        type: "button",
        className: "jsh-pwa-banner-btn jsh-pwa-banner-later",
        onClick: () => setVisible(false),
      },
      "Pita"
    )
  );
}

let mounted = false;

export function mountPwaUpdatePrompt(): void {
  if (mounted) return;
  mounted = true;
  const style = document.createElement("style");
  style.textContent = BANNER_CSS;
  document.head.appendChild(style);
  const host = document.createElement("div");
  host.id = "pwa-update-host";
  document.body.appendChild(host);
  createRoot(host).render(React.createElement(PwaUpdateBanner));
}
