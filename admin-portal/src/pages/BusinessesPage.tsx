import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import type { BusinessSummary } from "../lib/types";
import { dateShort, money, PIPELINE_LABEL } from "../lib/format";
import { useAuthStore } from "../lib/authStore";
import {
  BalanceBadge,
  BillingBadge,
  Button,
  Card,
  Empty,
  Input,
  Loading,
  PipelineBadge,
  Select,
} from "../components/ui";

export default function BusinessesPage() {
  const [items, setItems] = useState<BusinessSummary[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [pipeline, setPipeline] = useState("");
  const [billing, setBilling] = useState("");
  const [balance, setBalance] = useState("");
  const navigate = useNavigate();
  const admin = useAuthStore((s) => s.admin);
  const canRegister = admin?.role === "sales" || admin?.role === "super_admin";

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (pipeline) params.set("pipeline", pipeline);
      if (billing) params.set("billing", billing);
      if (balance) params.set("balance", balance);
      const res = await api.get<{ items: BusinessSummary[] }>(`/businesses?${params.toString()}`);
      setItems(res.items);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [q, pipeline, billing, balance]);

  useEffect(() => {
    const timer = setTimeout(load, 180);
    return () => clearTimeout(timer);
  }, [load]);

  if (error && !items) return <div className="error-text">{error}</div>;

  return (
    <>
      <div className="toolbar">
        <Input
          placeholder="Search name, contact, email…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ minWidth: 260 }}
        />
        <Select value={pipeline} onChange={(e) => setPipeline(e.target.value)}>
          <option value="">All pipeline stages</option>
          {Object.entries(PIPELINE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Select value={billing} onChange={(e) => setBilling(e.target.value)}>
          <option value="">Any billing status</option>
          <option value="active">Active</option>
          <option value="expired">Expired</option>
          <option value="none">No subscription</option>
        </Select>
        <Select value={balance} onChange={(e) => setBalance(e.target.value)}>
          <option value="">Any balance</option>
          <option value="owed">Owes money</option>
          <option value="credit">Has credit</option>
          <option value="clear">Clear</option>
        </Select>
        <div className="spacer" />
        {canRegister ? (
          <Button variant="ember" onClick={() => navigate("/businesses/new")}>
            + Register business
          </Button>
        ) : null}
      </div>

      <Card>
        {!items ? (
          <Loading />
        ) : items.length === 0 ? (
          <Empty title="No businesses match these filters">
            Clear the filters, or register a new prospective customer.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Business</th>
                  <th>Pipeline</th>
                  <th>Billing</th>
                  <th>Balance</th>
                  <th>Seats</th>
                  <th>Renews</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((b) => (
                  <tr
                    key={b.id}
                    className="clickable"
                    onClick={() => navigate(`/businesses/${b.id}`)}
                  >
                    <td>
                      <div className="cell-title">{b.name}</div>
                      <div className="cell-sub">
                        {b.contactName ?? b.contactEmail ?? "—"}
                        {b.tierName ? ` • ${b.tierName}` : ""}
                      </div>
                    </td>
                    <td>
                      <PipelineBadge status={b.pipelineStatus} />
                    </td>
                    <td>
                      <BillingBadge business={b} />
                    </td>
                    <td>
                      {b.subscription ? <BalanceBadge business={b} /> : <span className="muted">—</span>}
                      <div className="cell-sub">
                        {b.balanceCents !== 0 ? money(Math.abs(b.balanceCents), b.subscription?.currency) : "settled"}
                      </div>
                    </td>
                    <td>
                      {b.subscription
                        ? `${b.subscription.baseSeats + b.subscription.extraSeats} (${b.subscription.extraSeats} paid)`
                        : "—"}
                    </td>
                    <td>{b.subscription ? dateShort(b.subscription.renewsAt) : "—"}</td>
                    <td className="right muted">→</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {error ? <div className="error-text mt">{error}</div> : null}
    </>
  );
}
