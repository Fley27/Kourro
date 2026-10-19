// expo-sharing → Web Share API with a download fallback.
//
// Receipt "share as PDF" flows pass the blob URL produced by the expo-print
// shim. Desktop browsers either open the (formatted, printable) receipt in a
// share sheet when the OS supports file sharing, or download it as a file.
function filenameFor(uri: string, mimeType?: string): string {
  const stamp = new Date().toISOString().slice(0, 10);
  if (mimeType === "application/pdf") return `resi-${stamp}.pdf`;
  if (mimeType?.startsWith("image/")) return `resi-${stamp}.png`;
  return `resi-${stamp}.html`;
}

async function toFile(uri: string, filename: string, mimeType?: string): Promise<File | null> {
  try {
    const response = await fetch(uri);
    const blob = await response.blob();
    return new File([blob], filename, { type: mimeType ?? blob.type ?? "application/octet-stream" });
  } catch {
    return null;
  }
}

export async function isAvailableAsync(): Promise<boolean> {
  return true;
}

export async function shareAsync(
  uri: string,
  options?: { mimeType?: string; dialogTitle?: string; UTI?: string }
): Promise<void> {
  const filename = filenameFor(uri, options?.mimeType);
  const nav = window.navigator as Navigator & {
    share?: (data: unknown) => Promise<void>;
    canShare?: (data: unknown) => boolean;
  };

  if (typeof nav.share === "function") {
    const file = await toFile(uri, filename, options?.mimeType);
    if (file && (typeof nav.canShare !== "function" || nav.canShare({ files: [file] }))) {
      try {
        await nav.share({ files: [file], title: options?.dialogTitle });
        return;
      } catch (error: unknown) {
        if ((error as { name?: string })?.name === "AbortError") return;
        // fall through to download
      }
    }
  }

  const anchor = document.createElement("a");
  anchor.href = uri;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export default { isAvailableAsync, shareAsync };
