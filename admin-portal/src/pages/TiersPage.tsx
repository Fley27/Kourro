import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import type { Tier } from "../lib/types";
import { centsToInput, inputToCents, money } from "../lib/format";
import {
  Button,
  Card,
  CardHead,
  Empty,
  ErrorText,
  Field,
  Input,
  Loading,
  Modal,
  Select,
  Textarea,
  toast,
} from "../components/ui";

type TierForm = {
  code: string;
  name: string;
  description: string;
  price: string;
  currency: string;
  interval: "monthly" | "yearly";
  baseSeats: string;
  seatPrice: string;
  maxStores: string;
  features: string;
  isActive: boolean;
  sortOrder: string;
};

function toForm(t: Tier): TierForm {
  return {
    code: t.code,
    name: t.name,
    description: t.description ?? "",
    price: centsToInput(t.priceCents, t.currency),
    currency: t.currency,
    interval: t.interval,
    baseSeats: String(t.baseSeats),
    seatPrice: centsToInput(t.seatPriceCents, t.currency),
    maxStores: t.maxStores === null ? "" : String(t.maxStores),
    features: JSON.stringify(t.features ?? {}, null, 2),
    isActive: t.isActive,
    sortOrder: String(t.sortOrder),
  };
}

const EMPTY: TierForm = {
  code: "",
  name: "",
  description: "",
  price: "0.00",
  currency: "HTG",
  interval: "monthly",
  baseSeats: "3",
  seatPrice: "0.00",
  maxStores: "",
  features: "{}",
  isActive: true,
  sortOrder: "0",
};

export default function TiersPage() {
  const [items, setItems] = useState<Tier[] | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<null | { mode: "new" } | { mode: "edit"; tier: Tier }>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ items: Tier[] }>("/tiers");
      setItems(res.items);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const deactivate = async (tier: Tier) => {
    if (!window.confirm(`Deactivate "${tier.name}"? Existing subscriptions keep their prices.`)) return;
    try {
      await api.del(`/tiers/${tier.id}`);
      toast("Tier deactivated", "success");
      load();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  if (error && !items) return <div className="error-text">{error}</div>;
  if (!items) return <Loading />;

  return (
    <>
      <div className="toolbar">
        <div className="muted">
          Tiers live in the database — edit freely. Onboarding stays loose: limits are recorded but
          not enforced yet.
        </div>
        <div className="spacer" />
        <Button variant="ember" onClick={() => setEditing({ mode: "new" })}>
          + New tier
        </Button>
      </div>

      {items.length === 0 ? (
        <Card>
          <Empty title="No tiers yet" />
        </Card>
      ) : (
        <div className="grid cols-3">
          {items.map((t) => (
            <Card key={t.id}>
              <CardHead
                title={t.name}
                sub={t.code}
                right={
                  <span className={`badge ${t.isActive ? "badge-green" : "badge-gray"}`}>
                    {t.isActive ? "active" : "inactive"}
                  </span>
                }
              />
              <div className="card-pad">
                <div style={{ fontSize: 24, fontWeight: 800 }}>
                  {money(t.priceCents, t.currency)}
                  <span className="muted" style={{ fontSize: 13 }}>
                    /{t.interval === "yearly" ? "year" : "month"}
                  </span>
                </div>
                {t.description ? <p className="muted" style={{ margin: "8px 0 0" }}>{t.description}</p> : null}

                <dl className="kv" style={{ marginTop: 14 }}>
                  <dt>Included seats</dt>
                  <dd>{t.baseSeats}</dd>
                  <dt>Extra seat price</dt>
                  <dd>
                    {money(t.seatPriceCents, t.currency)}/{t.interval === "yearly" ? "yr" : "mo"}
                  </dd>
                  <dt>Max stores</dt>
                  <dd>{t.maxStores === null ? "Unlimited" : t.maxStores}</dd>
                  <dt>In use</dt>
                  <dd>
                    {t.subscriptionCount} subscription(s), {t.businessCount} business(es)
                  </dd>
                </dl>

                {Object.keys(t.features ?? {}).length > 0 ? (
                  <div className="pill-group" style={{ marginTop: 12 }}>
                    {Object.entries(t.features).map(([key, value]) => (
                      <span key={key} className={`badge plain ${value ? "badge-blue" : "badge-gray"}`}>
                        {key}: {String(value)}
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="form-actions" style={{ marginTop: 16 }}>
                  <Button size="sm" variant="ghost" onClick={() => setEditing({ mode: "edit", tier: t })}>
                    Edit
                  </Button>
                  {t.isActive ? (
                    <Button size="sm" variant="danger" onClick={() => deactivate(t)}>
                      Deactivate
                    </Button>
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {editing ? (
        <TierModal
          tier={editing.mode === "edit" ? editing.tier : null}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            load();
          }}
        />
      ) : null}
    </>
  );
}

function TierModal({ tier, onClose, onDone }: { tier: Tier | null; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState<TierForm>(tier ? toForm(tier) : EMPTY);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (key: keyof TierForm) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      let features: Record<string, unknown>;
      try {
        features = JSON.parse(form.features || "{}");
      } catch {
        throw new Error("Features must be valid JSON.");
      }
      const payload = {
        code: form.code,
        name: form.name,
        description: form.description || null,
        priceCents: inputToCents(form.price, form.currency),
        currency: form.currency,
        interval: form.interval,
        baseSeats: Number(form.baseSeats),
        seatPriceCents: inputToCents(form.seatPrice, form.currency),
        maxStores: form.maxStores === "" ? null : Number(form.maxStores),
        features,
        isActive: form.isActive,
        sortOrder: Number(form.sortOrder),
      };
      if (tier) {
        await api.patch(`/tiers/${tier.id}`, payload);
        toast("Tier updated", "success");
      } else {
        await api.post("/tiers", payload);
        toast("Tier created", "success");
      }
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={tier ? `Edit ${tier.name}` : "New subscription tier"}
      sub="Stored in adm_tiers — never hardcoded. Changes don't rewrite existing subscriptions (they snapshot their prices)."
      onClose={onClose}
      wide
    >
      <ErrorText>{error}</ErrorText>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Code *">
            <Input value={form.code} onChange={set("code")} disabled={!!tier} placeholder="growth" required />
          </Field>
          <Field label="Name *">
            <Input value={form.name} onChange={set("name")} required />
          </Field>
          <div className="full">
            <Field label="Description">
              <Textarea value={form.description} onChange={set("description")} />
            </Field>
          </div>
          <Field label="Price">
            <Input value={form.price} onChange={set("price")} inputMode="decimal" />
          </Field>
          <Field label="Currency">
            <Input value={form.currency} onChange={set("currency")} />
          </Field>
          <Field label="Billing interval">
            <Select value={form.interval} onChange={set("interval")}>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </Select>
          </Field>
          <Field label="Sort order">
            <Input type="number" value={form.sortOrder} onChange={set("sortOrder")} />
          </Field>
          <Field label="Included seats (base)">
            <Input type="number" min={0} value={form.baseSeats} onChange={set("baseSeats")} />
          </Field>
          <Field label="Price per extra seat">
            <Input value={form.seatPrice} onChange={set("seatPrice")} inputMode="decimal" />
          </Field>
          <Field label="Max stores" help="Blank = unlimited.">
            <Input type="number" min={1} value={form.maxStores} onChange={set("maxStores")} placeholder="∞" />
          </Field>
          <Field label="Active">
            <Select
              value={form.isActive ? "yes" : "no"}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.value === "yes" }))}
            >
              <option value="yes">Active (available for new business)</option>
              <option value="no">Inactive</option>
            </Select>
          </Field>
          <div className="full">
            <Field label="Features (JSON)" help="Free-form feature access map for future limits.">
              <Textarea
                value={form.features}
                onChange={set("features")}
                style={{ fontFamily: "var(--mono)", fontSize: 12.5 }}
              />
            </Field>
          </div>
        </div>
        <div className="form-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="ember" disabled={busy}>
            {busy ? "Saving…" : tier ? "Save changes" : "Create tier"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
