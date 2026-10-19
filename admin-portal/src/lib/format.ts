const CURRENCY_DECIMALS: Record<string, number> = { HTG: 2, USD: 2, EUR: 2 };

export function money(cents: number, currency = "HTG"): string {
  const decimals = CURRENCY_DECIMALS[currency] ?? 2;
  const value = cents / 10 ** decimals;
  return `${value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })} ${currency}`;
}

export function centsToInput(cents: number, currency = "HTG"): string {
  const decimals = CURRENCY_DECIMALS[currency] ?? 2;
  return (cents / 10 ** decimals).toFixed(decimals);
}

export function inputToCents(value: string, currency = "HTG"): number {
  const decimals = CURRENCY_DECIMALS[currency] ?? 2;
  const parsed = Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(parsed)) return NaN;
  return Math.round(parsed * 10 ** decimals);
}

export function dateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return dateShort(iso);
}

export function toLocalInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const PIPELINE_LABEL: Record<string, string> = {
  prospect: "Prospect",
  paid: "Paid",
  setup_scheduled: "Setup booked",
  setup_complete: "Setup complete",
  cancelled: "Cancelled",
};

export const INVOICE_KIND_LABEL: Record<string, string> = {
  initial: "Initial period",
  renewal: "Renewal",
  seat_proration: "Seat proration",
  tier_upgrade: "Tier upgrade",
  manual: "Manual",
};

export const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  transfer: "Transfer",
  mobile_money: "Mobile money",
  other: "Other",
};
