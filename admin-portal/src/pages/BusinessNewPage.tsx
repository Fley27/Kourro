import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import type { BusinessSummary, Tier } from "../lib/types";
import { money } from "../lib/format";
import {
  Button,
  Card,
  ErrorText,
  Field,
  Input,
  Loading,
  Select,
  Textarea,
  toast,
} from "../components/ui";

export default function BusinessNewPage() {
  const navigate = useNavigate();
  const [tiers, setTiers] = useState<Tier[] | null>(null);
  const [form, setForm] = useState({
    name: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    address: "",
    tierId: "",
    notes: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<{ items: Tier[] }>("/tiers")
      .then((res) => setTiers(res.items))
      .catch((e) => setError(e.message));
  }, []);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const business = await api.post<BusinessSummary>("/businesses", {
        name: form.name,
        contactName: form.contactName || undefined,
        contactEmail: form.contactEmail || undefined,
        contactPhone: form.contactPhone || undefined,
        address: form.address || undefined,
        tierId: form.tierId || undefined,
        notes: form.notes || undefined,
      });
      toast(`${business.name} added to the pipeline`, "success");
      navigate(`/businesses/${business.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!tiers) return <Loading />;

  return (
    <div style={{ maxWidth: 760 }}>
      <Card className="card-pad">
        <ErrorText>{error}</ErrorText>
        <form onSubmit={submit}>
          <div className="form-grid">
            <Field label="Business name *">
              <Input value={form.name} onChange={set("name")} required autoFocus placeholder="Magazen Lakay" />
            </Field>
            <Field label="Contact person">
              <Input value={form.contactName} onChange={set("contactName")} placeholder="Jean Pierre" />
            </Field>
            <Field label="Contact email">
              <Input type="email" value={form.contactEmail} onChange={set("contactEmail")} placeholder="jean@magazen.ht" />
            </Field>
            <Field label="Contact phone">
              <Input value={form.contactPhone} onChange={set("contactPhone")} placeholder="+509 …" />
            </Field>
            <Field label="Address">
              <Input value={form.address} onChange={set("address")} placeholder="Delmas 33, Port-au-Prince" />
            </Field>
            <Field label="Tier (optional)" help="Can also be chosen by the technician during setup.">
              <Select value={form.tierId} onChange={set("tierId")}>
                <option value="">Decide later</option>
                {tiers
                  .filter((t) => t.isActive)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} — {money(t.priceCents, t.currency)}/{t.interval === "yearly" ? "yr" : "mo"} •{" "}
                      {t.baseSeats} seats included
                    </option>
                  ))}
              </Select>
            </Field>
            <div className="full">
              <Field label="Notes">
                <Textarea value={form.notes} onChange={set("notes")} placeholder="How you found them, what they asked for…" />
              </Field>
            </div>
          </div>

          <div className="form-actions">
            <Button variant="ghost" onClick={() => navigate("/businesses")}>
              Cancel
            </Button>
            <Button type="submit" variant="ember" disabled={busy}>
              {busy ? "Saving…" : "Register business"}
            </Button>
          </div>
        </form>
      </Card>

      <div className="notice mt">
        Registering only creates the prospect — payment and the setup appointment are separate steps
        you can take from the business page.
      </div>
    </div>
  );
}
