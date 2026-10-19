import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import type { BusinessDetail, Invoice, RenewResult, SeatAddResult, SubscriptionInfo, Tier, TierChangeResult } from "../lib/types";
import {
  centsToInput,
  dateShort,
  dateTime,
  INVOICE_KIND_LABEL,
  inputToCents,
  METHOD_LABEL,
  money,
  PIPELINE_LABEL,
  timeAgo,
} from "../lib/format";
import { useAuthStore } from "../lib/authStore";
import {
  BalanceBadge,
  BillingBadge,
  Button,
  Card,
  CardHead,
  Empty,
  ErrorText,
  Field,
  Input,
  Loading,
  Modal,
  PipelineBadge,
  Select,
  Textarea,
  toast,
} from "../components/ui";

const BUSINESS_TYPES = [
  "grocery",
  "restaurant",
  "pharmacy",
  "hardware",
  "clothing",
  "boutique",
  "bakery",
  "electronics",
  "other",
];

function randomPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(14);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export default function BusinessDetailPage() {
  const { id = "" } = useParams();
  const admin = useAuthStore((s) => s.admin);
  const [detail, setDetail] = useState<BusinessDetail | null>(null);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<null | "payment" | "appointment" | "setup" | "seats" | "renew" | "tier">(null);

  const isSuper = admin?.role === "super_admin";
  const isSales = admin?.role === "sales" || isSuper;
  const isTech = admin?.role === "technician" || isSuper;

  const load = useCallback(async () => {
    try {
      const res = await api.get<BusinessDetail>(`/businesses/${id}`);
      setDetail(res);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    load();
    api
      .get<{ items: Tier[] }>("/tiers")
      .then((r) => setTiers(r.items))
      .catch(() => undefined);
  }, [load]);

  if (error && !detail) {
    return (
      <div>
        <ErrorText>{error}</ErrorText>
        <Link className="link-btn" to="/businesses">
          ← Back to businesses
        </Link>
      </div>
    );
  }
  if (!detail) return <Loading />;

  const b = detail;
  const sub = b.subscription;
  const setupDone = b.pipelineStatus === "setup_complete";

  return (
    <>
      <div className="detail-head">
        <div>
          <Link className="link-btn" to="/businesses">
            ← Businesses
          </Link>
          <h2 style={{ marginTop: 6 }}>{b.name}</h2>
          <div className="badges">
            <PipelineBadge status={b.pipelineStatus} />
            <BillingBadge business={b} />
            <BalanceBadge business={b} />
            {b.businessType ? <span className="badge badge-violet plain">{b.businessType}</span> : null}
          </div>
        </div>
        <div className="spacer" />
        <div className="action-bar">
          {isSales ? (
            <Button variant="ember" onClick={() => setModal("payment")}>
              Record payment
            </Button>
          ) : null}
          {isSales && !setupDone ? (
            <Button variant="ghost" onClick={() => setModal("appointment")}>
              Book setup appointment
            </Button>
          ) : null}
          {isTech && !setupDone ? (
            <Button variant="ember" onClick={() => setModal("setup")}>
              Complete setup
            </Button>
          ) : null}
          {isTech && setupDone && sub?.status === "active" ? (
            <Button onClick={() => setModal("seats")}>Add seats</Button>
          ) : null}
        </div>
      </div>

      <div className="grid cols-3 mb">
        <Card className="stat accent-ember">
          <div className="label">Balance</div>
          <div className="value" style={{ fontSize: 22 }}>
            {money(Math.abs(b.balanceCents), sub?.currency ?? "HTG")}
          </div>
          <div className="hint">
            {b.owedCents > 0 ? "owed to you" : b.creditCents > 0 ? "credit on file" : "settled"}
          </div>
        </Card>
        <Card className="stat accent-green">
          <div className="label">Subscription</div>
          <div className="value" style={{ fontSize: 22 }}>
            {sub ? (sub.status === "active" ? "Active" : "Expired") : "Not started"}
          </div>
          <div className="hint">
            {sub
              ? `${b.tierName ?? "tier"} • renews ${dateShort(sub.renewsAt)}`
              : "starts when setup completes"}
          </div>
        </Card>
        <Card className="stat accent-blue">
          <div className="label">Seats</div>
          <div className="value" style={{ fontSize: 22 }}>
            {sub ? `${sub.baseSeats + sub.extraSeats}` : "—"}
          </div>
          <div className="hint">
            {sub
              ? `${sub.baseSeats} included + ${sub.extraSeats} paid extra @ ${money(sub.seatPriceCents, sub.currency)}`
              : "no subscription yet"}
          </div>
        </Card>
      </div>

      <div className="grid cols-2">
        <Card>
          <CardHead title="Account" sub="Pipeline, owner and contact" />
          <div className="card-pad">
            <dl className="kv">
              <dt>Contact</dt>
              <dd>
                {b.contactName ?? "—"} {b.contactPhone ? `• ${b.contactPhone}` : ""}
                {b.contactEmail ? <div className="cell-sub">{b.contactEmail}</div> : null}
              </dd>
              <dt>Address</dt>
              <dd>{b.address ?? "—"}</dd>
              <dt>Registered</dt>
              <dd>
                {dateShort(b.createdAt)}
                {b.notes ? <div className="cell-sub">{b.notes}</div> : null}
              </dd>
              <dt>Setup appointment</dt>
              <dd>{dateTime(b.setupAppointmentAt)}</dd>
              <dt>Setup completed</dt>
              <dd>{dateTime(b.setupCompletedAt)}</dd>
              <dt>Owner account</dt>
              <dd>
                {b.ownerEmail ?? "—"}
                {b.staff.profileAccounts !== null ? (
                  <div className="cell-sub">
                    {b.staff.profileAccounts} portal account(s) • {b.staff.employeeRecords} staff record(s)
                  </div>
                ) : null}
              </dd>
              <dt>Business type</dt>
              <dd>{b.businessType ?? "—"}</dd>
            </dl>
          </div>
        </Card>

        <Card>
          <CardHead
            title="Subscription"
            sub={sub ? "Billing clock started at setup completion" : "Not yet started"}
            right={
              sub && sub.status === "active" && isSales ? (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Button size="sm" variant="ghost" onClick={() => setModal("renew")}>
                    Renew now
                  </Button>
                  <Button size="sm" onClick={() => setModal("tier")}>
                    Upgrade tier
                  </Button>
                </div>
              ) : undefined
            }
          />
          {!sub ? (
            <Empty title="No subscription yet">
              Complete setup as a technician to start the billing clock.
            </Empty>
          ) : (
            <div className="card-pad">
              <dl className="kv">
                <dt>Tier</dt>
                <dd>
                  {b.tierName} — {money(sub.tierPriceCents, sub.currency)}/
                  {sub.interval === "yearly" ? "yr" : "mo"}
                </dd>
                <dt>Status</dt>
                <dd>
                  <span className={`badge ${sub.status === "active" ? "badge-green" : "badge-red"}`}>
                    {sub.status}
                  </span>
                  {b.renewingSoon && sub.status === "active" ? (
                    <span className="badge badge-amber" style={{ marginLeft: 6 }}>
                      Renewing soon
                    </span>
                  ) : null}
                </dd>
                <dt>Billing started</dt>
                <dd>
                  {dateShort(sub.startedAt)}{" "}
                  {b.setupCompletedAt ? <span className="muted">(setup completion)</span> : null}
                </dd>
                <dt>Current period</dt>
                <dd>
                  {dateShort(sub.currentPeriodStart)} → {dateShort(sub.renewsAt)}
                </dd>
                <dt>Monthly recurring</dt>
                <dd>
                  {money(
                    sub.tierPriceCents + sub.extraSeats * sub.seatPriceCents,
                    sub.currency
                  )}
                  <span className="cell-sub">tier + {sub.extraSeats} extra seat(s) — one lump sum at renewal</span>
                </dd>
              </dl>
              <div className="seat-meter">
                <div className="seat-chip">
                  <b>{sub.baseSeats}</b> included
                </div>
                <div className="seat-chip">
                  <b>{sub.extraSeats}</b> paid extra
                </div>
                <div className="seat-chip">
                  <b>{sub.baseSeats + sub.extraSeats}</b> total seats
                </div>
                <div className="seat-chip">
                  <b>{money(sub.seatPriceCents, sub.currency)}</b> per extra seat
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>

      <div className="section-title">Invoices & payments</div>
      <div className="grid cols-2">
        <Card>
          <CardHead title="Invoices" sub={`${detail.invoices.length} total`} />
          {detail.invoices.length === 0 ? (
            <Empty title="No invoices yet" />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Kind</th>
                    <th className="num">Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.invoices.map((inv) => (
                    <tr key={inv.id}>
                      <td>
                        <div className="cell-title mono">{inv.number}</div>
                        <div className="cell-sub">{inv.description}</div>
                        <div className="cell-sub">{dateShort(inv.createdAt)}</div>
                      </td>
                      <td>{INVOICE_KIND_LABEL[inv.kind]}</td>
                      <td className="num">{money(inv.amountCents, sub?.currency)}</td>
                      <td>
                        <span
                          className={`badge ${
                            inv.status === "paid"
                              ? "badge-green"
                              : inv.status === "open"
                                ? "badge-amber"
                                : "badge-gray"
                          }`}
                        >
                          {inv.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHead title="Payments" sub={`${detail.payments.length} recorded`} />
          {detail.payments.length === 0 ? (
            <Empty title="No payments recorded" />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Received</th>
                    <th>Method</th>
                    <th className="num">Amount</th>
                    <th className="num">Applied</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.payments.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div className="cell-title">{dateTime(p.receivedAt)}</div>
                        {p.reference ? <div className="cell-sub mono">{p.reference}</div> : null}
                        {p.notes ? <div className="cell-sub">{p.notes}</div> : null}
                      </td>
                      <td>{METHOD_LABEL[p.method] ?? p.method}</td>
                      <td className="num">{money(p.amountCents, p.currency)}</td>
                      <td className="num muted">{money(p.appliedCents, p.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="section-title">Activity</div>
      <Card>
        {detail.activity.length === 0 ? (
          <Empty title="No activity yet" />
        ) : (
          <div className="rows timeline">
            {detail.activity.map((item) => (
              <div key={item.id} className="row-item">
                <div className="grow">
                  <div className="title">{item.summary}</div>
                  <div className="sub mono">
                    {item.action} • {item.actorLabel}
                  </div>
                </div>
                <div className="when">{timeAgo(item.createdAt)}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {modal === "payment" ? (
        <PaymentModal
          businessId={b.id}
          defaultAmount={b.owedCents > 0 ? b.owedCents : sub?.tierPriceCents ?? 0}
          currency={sub?.currency ?? "HTG"}
          openInvoices={b.invoices.filter((inv) => inv.status === "open")}
          onClose={() => setModal(null)}
          onDone={load}
        />
      ) : null}
      {modal === "appointment" ? (
        <AppointmentModal businessId={b.id} current={b.setupAppointmentAt} onClose={() => setModal(null)} onDone={load} />
      ) : null}
      {modal === "setup" ? (
        <SetupModal businessId={b.id} tiers={tiers} defaultTierId={b.tierId} businessName={b.name} onClose={() => setModal(null)} onDone={load} />
      ) : null}
      {modal === "seats" ? (
        <SeatsModal businessId={b.id} businessName={b.name} onClose={() => setModal(null)} onDone={load} />
      ) : null}
      {modal === "renew" && sub ? (
        <RenewModal
          businessId={b.id}
          businessName={b.name}
          sub={sub}
          onClose={() => setModal(null)}
          onDone={load}
        />
      ) : null}
      {modal === "tier" && sub ? (
        <UpgradeTierModal
          businessId={b.id}
          businessName={b.name}
          tiers={tiers}
          currentTierId={b.tierId}
          sub={sub}
          onClose={() => setModal(null)}
          onDone={load}
        />
      ) : null}
    </>
  );
}

/* ---------------- payment ---------------- */

function PaymentModal({
  businessId,
  defaultAmount,
  currency,
  openInvoices,
  onClose,
  onDone,
}: {
  businessId: string;
  defaultAmount: number;
  currency: string;
  openInvoices: Invoice[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState(centsToInput(defaultAmount, currency));
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const owedTotal = openInvoices.reduce((sum, inv) => sum + inv.amountCents, 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const cents = inputToCents(amount, currency);
    if (!Number.isFinite(cents) || cents <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await api.post<{ receipt?: { sent: boolean; to: string | null; error?: string } }>(
        `/businesses/${businessId}/payments`,
        {
          amountCents: cents,
          method,
          reference: reference || undefined,
          notes: notes || undefined,
        }
      );
      const receipt = res.receipt;
      if (receipt?.sent) toast(`Payment recorded — receipt emailed to ${receipt.to}`, "success");
      else if (receipt?.error) toast("Payment recorded — receipt email failed (payment saved)", "success");
      else toast("Payment recorded", "success");
      onDone();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Record payment"
      sub="Settles open invoices (FIFO). The owner receives an emailed receipt with the breakdown."
      onClose={onClose}
    >
      <ErrorText>{error}</ErrorText>
      <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
        {openInvoices.length > 0 ? (
          <div className="payment-breakdown">
            <div className="payment-breakdown-title">Owed — {money(owedTotal, currency)}</div>
            {openInvoices.map((inv) => (
              <div key={inv.id} className="payment-breakdown-line">
                <span>
                  {INVOICE_KIND_LABEL[inv.kind] ?? inv.kind} <span className="cell-sub">{inv.number}</span>
                </span>
                <span style={{ whiteSpace: "nowrap" }}>{money(inv.amountCents, currency)}</span>
              </div>
            ))}
            <div className="payment-breakdown-line payment-breakdown-total">
              <span>Total</span>
              <span>{money(owedTotal, currency)}</span>
            </div>
          </div>
        ) : null}
        <Field label={`Amount (${currency})`} help="Money you physically collected.">
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoFocus />
        </Field>
        <Field label="Method">
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="cash">Cash</option>
            <option value="mobile_money">Mobile money</option>
            <option value="transfer">Transfer</option>
            <option value="card">Card</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        <Field label="Reference">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="receipt #, transaction id…" />
        </Field>
        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <div className="form-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="ember" disabled={busy}>
            {busy ? "Saving…" : "Record payment"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------- appointment ---------------- */

function AppointmentModal({
  businessId,
  current,
  onClose,
  onDone,
}: {
  businessId: string;
  current: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [when, setWhen] = useState(() => {
    const d = current ? new Date(current) : new Date(Date.now() + 3 * 86400000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.post(`/businesses/${businessId}/appointment`, {
        setupAppointmentAt: new Date(when).toISOString(),
      });
      toast("Setup appointment booked", "success");
      onDone();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Book setup appointment" sub="When should the technician go on-site (or connect remotely)?" onClose={onClose}>
      <ErrorText>{error}</ErrorText>
      <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
        <Field label="Date & time">
          <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required autoFocus />
        </Field>
        <div className="form-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="ember" disabled={busy}>
            {busy ? "Saving…" : "Book appointment"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------- setup ---------------- */

function SetupModal({
  businessId,
  tiers,
  defaultTierId,
  businessName,
  onClose,
  onDone,
}: {
  businessId: string;
  tiers: Tier[];
  defaultTierId: string | null;
  businessName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    ownerEmail: "",
    ownerFullName: "",
    tempPassword: randomPassword(),
    businessType: "grocery",
    tierId: defaultTierId ?? tiers.find((t) => t.isActive)?.id ?? "",
    storeName: businessName,
    language: "ht",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.post(`/businesses/${businessId}/setup`, {
        ownerEmail: form.ownerEmail,
        ownerFullName: form.ownerFullName,
        tempPassword: form.tempPassword,
        businessType: form.businessType,
        tierId: form.tierId || undefined,
        storeName: form.storeName || undefined,
        language: form.language,
      });
      toast("Setup completed — subscription billing started", "success");
      onDone();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Complete setup"
      sub="Creating the owner account and starting the subscription. The billing clock starts NOW — not at the payment date."
      onClose={onClose}
      wide
    >
      <ErrorText>{error}</ErrorText>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Owner email *">
            <Input type="email" value={form.ownerEmail} onChange={set("ownerEmail")} required autoFocus />
          </Field>
          <Field label="Owner full name *">
            <Input value={form.ownerFullName} onChange={set("ownerFullName")} required />
          </Field>
          <Field label="Temporary password *" help="Hand this to the owner once — it is never stored.">
            <div style={{ display: "flex", gap: 8 }}>
              <Input value={form.tempPassword} onChange={set("tempPassword")} minLength={8} required />
              <Button variant="ghost" size="sm" onClick={() => setForm((f) => ({ ...f, tempPassword: randomPassword() }))}>
                Regenerate
              </Button>
            </div>
          </Field>
          <Field label="Language">
            <Select value={form.language} onChange={set("language")}>
              <option value="ht">Kreyòl</option>
              <option value="fr">Français</option>
              <option value="en">English</option>
            </Select>
          </Field>
          <Field label="Business type *">
            <div style={{ display: "flex", gap: 8 }}>
              <Select value={form.businessType} onChange={set("businessType")}>
                {BUSINESS_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
              {form.businessType === "other" ? (
                <Input
                  placeholder="Describe…"
                  onChange={(e) => setForm((f) => ({ ...f, businessType: e.target.value }))}
                />
              ) : null}
            </div>
          </Field>
          <Field label="Subscription tier *">
            <Select value={form.tierId} onChange={set("tierId")} required>
              <option value="">Choose a tier…</option>
              {tiers
                .filter((t) => t.isActive)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} — {money(t.priceCents, t.currency)}/{t.interval === "yearly" ? "yr" : "mo"}
                  </option>
                ))}
            </Select>
          </Field>
          <div className="full">
            <Field label="Store name" help="Defaults to the business name.">
              <Input value={form.storeName} onChange={set("storeName")} />
            </Field>
          </div>
        </div>

        <div className="notice warn" style={{ marginTop: 14 }}>
          Completing setup creates the owner's portal account, writes the organization/store records,
          starts the subscription (first renewal = today + one interval) and settles any payment
          already collected against the first invoice.
        </div>

        <div className="form-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="ember" disabled={busy}>
            {busy ? "Setting up…" : "Complete setup & start billing"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------- seats ---------------- */

function SeatsModal({
  businessId,
  businessName,
  onClose,
  onDone,
}: {
  businessId: string;
  businessName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [seats, setSeats] = useState("1");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api.post<SeatAddResult>(`/businesses/${businessId}/seats`, {
        seats: Number(seats),
      });
      toast(
        `Added ${result.seatsAdded} seat(s) — ${money(result.proratedCents)} prorated, renews ${dateShort(result.renewsAt)}`,
        "success"
      );
      onDone();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Add seats on the customer's behalf"
      sub={`${businessName} — mid-cycle seats are prorated to the existing renewal date, which never moves.`}
      onClose={onClose}
    >
      <ErrorText>{error}</ErrorText>
      <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
        <Field label="Extra seats to add">
          <Input
            type="number"
            min={1}
            max={50}
            value={seats}
            onChange={(e) => setSeats(e.target.value)}
            required
            autoFocus
          />
        </Field>
        <div className="notice">
          The seat is active immediately. The prorated stub is invoiced now; from the renewal date on,
          everything bills as one lump sum.
        </div>
        <div className="form-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="ember" disabled={busy}>
            {busy ? "Adding…" : "Add seats"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------- renew ---------------- */

/** Same display math as the server: an overdue period restarts from today. */
function nextRenewalDate(renewsAt: string, interval: "monthly" | "yearly"): Date {
  const base = new Date(Math.max(new Date(renewsAt).getTime(), Date.now()));
  if (interval === "yearly") base.setFullYear(base.getFullYear() + 1);
  else base.setMonth(base.getMonth() + 1);
  return base;
}

function RenewModal({
  businessId,
  businessName,
  sub,
  onClose,
  onDone,
}: {
  businessId: string;
  businessName: string;
  sub: SubscriptionInfo;
  onClose: () => void;
  onDone: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const amountCents = sub.tierPriceCents + sub.extraSeats * sub.seatPriceCents;
  const next = nextRenewalDate(sub.renewsAt, sub.interval);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api.post<RenewResult>(`/businesses/${businessId}/renew`);
      toast(
        `Renewed — renews ${dateShort(result.renewsAt)} (${money(result.amountCents, sub.currency)} invoiced)`,
        "success"
      );
      onDone();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Renew subscription"
      sub={`${businessName} — issues the lump-sum renewal invoice now and extends the period by one ${sub.interval === "yearly" ? "year" : "month"}.`}
      onClose={onClose}
    >
      <ErrorText>{error}</ErrorText>
      <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
        <dl className="kv">
          <dt>Renews today</dt>
          <dd>{dateShort(sub.renewsAt)}</dd>
          <dt>New period ends</dt>
          <dd>{dateShort(next.toISOString())}</dd>
          <dt>Renewal invoice</dt>
          <dd>
            {money(amountCents, sub.currency)}
            <span className="cell-sub">
              tier + {sub.extraSeats} extra seat(s) — one lump sum, due at period end + grace
            </span>
          </dd>
        </dl>
        <div className="notice">
          Credit on the account is applied against the invoice immediately. Record a payment
          whenever the customer settles it.
        </div>
        <div className="form-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="ember" disabled={busy}>
            {busy ? "Renewing…" : "Renew now"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------- tier upgrade ---------------- */

function UpgradeTierModal({
  businessId,
  businessName,
  tiers,
  currentTierId,
  sub,
  onClose,
  onDone,
}: {
  businessId: string;
  businessName: string;
  tiers: Tier[];
  currentTierId: string | null;
  sub: SubscriptionInfo;
  onClose: () => void;
  onDone: () => void;
}) {
  const [tierId, setTierId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const options = tiers
    .filter((t) => t.interval === sub.interval)
    .sort((a, b) => a.priceCents - b.priceCents);
  const selected = options.find((t) => t.id === tierId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!tierId) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.post<TierChangeResult>(`/businesses/${businessId}/tier`, {
        tierId,
      });
      if (result.changed) {
        toast(
          `Upgraded to ${result.tierName} — ${money(result.upgradeCents, sub.currency)} prorated, renews ${dateShort(result.renewsAt)}`,
          "success"
        );
      }
      onDone();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Upgrade subscription"
      sub={`${businessName} — the price difference is prorated for the days left in this period.`}
      onClose={onClose}
    >
      <ErrorText>{error}</ErrorText>
      <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
        <Field label="New tier">
          <Select value={tierId} onChange={(e) => setTierId(e.target.value)} required autoFocus>
            <option value="">Choose a tier…</option>
            {options.map((t) => {
              const current = t.id === currentTierId;
              const upgrade = t.priceCents > sub.tierPriceCents;
              const diff = t.priceCents - sub.tierPriceCents;
              return (
                <option key={t.id} value={t.id} disabled={current || !upgrade}>
                  {t.name} — {money(t.priceCents, t.currency)}/{t.interval === "yearly" ? "yr" : "mo"}
                  {current ? " (current)" : !upgrade ? " (not an upgrade)" : ` (+${money(diff, t.currency)})`}
                </option>
              );
            })}
          </Select>
        </Field>
        {selected ? (
          <div className="notice">
            {money(selected.priceCents - sub.tierPriceCents, sub.currency)} is prorated for the
            days left and invoiced now; the renewal date ({dateShort(sub.renewsAt)}) never moves.
            From then on everything bills as one lump sum at the new price.
          </div>
        ) : (
          <div className="notice">
            Upgrades apply immediately with a prorated charge to the existing renewal date —
            no approval, no change to the billing anniversary.
          </div>
        )}
        <div className="form-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="ember" disabled={busy || !tierId}>
            {busy ? "Upgrading…" : "Upgrade"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
