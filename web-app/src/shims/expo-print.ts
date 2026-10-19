// expo-print → browser print / blob downloads.
//
// printAsync(html): opens the system print sheet via a hidden iframe —
// on desktop this is the "Save as PDF" path the receipts need.
// printToFileAsync(html): expo returns a PDF file; the browser cannot
// synthesize a PDF without a full renderer, so we hand back an HTML blob
// URL. Sharing then downloads it, and printAsync covers the true PDF flow.
export async function printAsync(options: {
  html?: string;
  uri?: string;
  printerUrl?: string;
  width?: number;
  height?: number;
}): Promise<void> {
  if (options.uri) {
    window.open(options.uri, "_blank", "noopener");
    return;
  }
  const html = options.html;
  if (!html) throw new Error("printAsync requires `html` or `uri`");

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);

  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    frame.onload = finish;
    frame.srcdoc = html;
    window.setTimeout(finish, 2000);
  });

  try {
    const frameWindow = frame.contentWindow;
    if (!frameWindow) throw new Error("print frame unavailable");
    frameWindow.focus();
    frameWindow.print();
  } finally {
    // Give the print dialog time to consume the document before teardown.
    window.setTimeout(() => frame.remove(), 60_000);
  }
}

export async function printToFileAsync(options: {
  html?: string;
  base64?: boolean;
  width?: number;
  height?: number;
  margins?: unknown;
}): Promise<{ uri: string; base64?: string; numberOfPages?: number }> {
  const html = options.html;
  if (!html) throw new Error("printToFileAsync requires `html`");
  const blob = new Blob([html], { type: "text/html" });
  return { uri: URL.createObjectURL(blob), numberOfPages: 1 };
}

export async function selectPrinterAsync(): Promise<{ name: string; url: string }> {
  return { name: "Browser print dialog", url: "" };
}

export default { printAsync, printToFileAsync, selectPrinterAsync };
