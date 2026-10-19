import { create } from "zustand";
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { useEffect } from "react";
import type { BusinessSummary, PipelineStatus } from "../lib/types";
import { PIPELINE_LABEL } from "../lib/format";

/* ---------------- toast ---------------- */

type Toast = { id: number; message: string; kind: "info" | "error" | "success" };
let toastSeq = 0;

export const useToasts = create<{ toasts: Toast[]; push: (t: Toast) => void; drop: (id: number) => void }>(
  (set) => ({
    toasts: [],
    push: (t) => set((s) => ({ toasts: [...s.toasts, t] })),
    drop: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  })
);

export function toast(message: string, kind: Toast["kind"] = "info") {
  const id = ++toastSeq;
  useToasts.getState().push({ id, message, kind });
  setTimeout(() => useToasts.getState().drop(id), 4200);
}

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <div className="toaster">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind === "info" ? "" : t.kind}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

/* ---------------- primitives ---------------- */

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "ink" | "ember" | "ghost" | "danger";
  size?: "sm" | "md";
  block?: boolean;
};

export function Button({ variant = "ink", size = "md", block, className = "", ...rest }: BtnProps) {
  const classes = [
    "btn",
    variant === "ink" ? "" : variant,
    size === "sm" ? "sm" : "",
    block ? "block" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return <button type="button" className={classes} {...rest} />;
}

export function Spinner() {
  return <span className="spinner" aria-label="loading" />;
}

export function Loading() {
  return (
    <div className="loading-page">
      <Spinner />
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <b>{title}</b>
      {children}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>;
}

export function CardHead({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="card-head">
      <div>
        <h3>{title}</h3>
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
      <div className="spacer" />
      {right}
    </div>
  );
}

/* ---------------- badges ---------------- */

const PIPELINE_BADGE: Record<PipelineStatus, string> = {
  prospect: "badge-gray",
  paid: "badge-blue",
  setup_scheduled: "badge-amber",
  setup_complete: "badge-green",
  cancelled: "badge-red",
};

export function PipelineBadge({ status }: { status: PipelineStatus }) {
  return <span className={`badge ${PIPELINE_BADGE[status] ?? "badge-gray"}`}>{PIPELINE_LABEL[status] ?? status}</span>;
}

export function BillingBadge({ business }: { business: BusinessSummary }) {
  if (!business.subscription) {
    return <span className="badge badge-gray plain">No subscription</span>;
  }
  const expired = business.subscription.status === "expired";
  return (
    <span className="pill-group">
      <span className={`badge ${expired ? "badge-red" : "badge-green"}`}>
        {expired ? "Expired" : "Active"}
      </span>
      {business.renewingSoon && !expired ? (
        <span className="badge badge-amber">Renewing soon</span>
      ) : null}
    </span>
  );
}

export function BalanceBadge({ business }: { business: BusinessSummary }) {
  if (business.owedCents > 0) {
    return <span className="badge badge-red">Owed</span>;
  }
  if (business.creditCents > 0) {
    return <span className="badge badge-blue">Credit</span>;
  }
  return <span className="badge badge-green plain">Clear</span>;
}

/* ---------------- form fields ---------------- */

export function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {help ? <div className="help">{help}</div> : null}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="input" {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="select" {...props} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="textarea" {...props} />;
}

/* ---------------- modal ---------------- */

export function Modal({
  title,
  sub,
  onClose,
  children,
  wide,
}: {
  title: string;
  sub?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {sub ? <div className="modal-sub">{sub}</div> : null}
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/* ---------------- misc ---------------- */

export function ErrorText({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <div className="error-text">{children}</div>;
}

/* ---------------- brand ---------------- */

/** Kourro wordmark — vector SVG so it stays crisp at any size. */
export function BrandLogo({
  className,
  eager,
}: {
  className?: string;
  eager?: boolean;
}) {
  return (
    <img
      src="/logo.svg"
      alt="Kourro"
      className={className}
      width={978}
      height={256}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
    />
  );
}
