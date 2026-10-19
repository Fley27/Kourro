import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import type { Admin, AdminRole } from "../lib/types";
import { dateShort } from "../lib/format";
import { useAuthStore } from "../lib/authStore";
import {
  Button,
  Card,
  Empty,
  ErrorText,
  Field,
  Input,
  Loading,
  Modal,
  Select,
  toast,
} from "../components/ui";

const ROLE_LABEL: Record<AdminRole, string> = {
  super_admin: "Super admin",
  sales: "Sales",
  technician: "Technician",
};

export default function AdminsPage() {
  const [items, setItems] = useState<Admin[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [freshPassword, setFreshPassword] = useState<{ email: string; password: string } | null>(null);
  const me = useAuthStore((s) => s.admin);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ items: Admin[] }>("/admins");
      setItems(res.items);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleStatus = async (admin: Admin) => {
    const next = admin.status === "active" ? "disabled" : "active";
    if (next === "disabled" && !window.confirm(`Disable ${admin.email}? They will lose access immediately.`)) {
      return;
    }
    try {
      await api.patch(`/admins/${admin.id}`, { status: next });
      toast(`Account ${next === "active" ? "enabled" : "disabled"}`, "success");
      load();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const changeRole = async (admin: Admin, role: AdminRole) => {
    try {
      await api.patch(`/admins/${admin.id}`, { role });
      toast("Role updated", "success");
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
        <div className="muted">Only the super admin can create or change admin accounts.</div>
        <div className="spacer" />
        <Button variant="ember" onClick={() => setCreating(true)}>
          + New admin account
        </Button>
      </div>

      {freshPassword ? (
        <Card className="card-pad mb">
          <b>Account created for {freshPassword.email}</b>
          <p className="muted" style={{ margin: "6px 0 10px" }}>
            Share this temporary password with them now — it is not stored anywhere and cannot be
            recovered.
          </p>
          <div className="secret">{freshPassword.password}</div>
          <div className="form-actions">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void navigator.clipboard?.writeText(freshPassword.password);
                toast("Copied", "success");
              }}
            >
              Copy
            </Button>
            <Button size="sm" onClick={() => setFreshPassword(null)}>
              Done
            </Button>
          </div>
        </Card>
      ) : null}

      <Card>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Admin</th>
                <th>Role</th>
                <th>Status</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id}>
                  <td>
                    <div className="cell-title">{a.fullName}</div>
                    <div className="cell-sub">{a.email}</div>
                  </td>
                  <td>
                    {me?.id === a.id ? (
                      <span className={`badge ${a.role === "super_admin" ? "badge-violet" : "badge-blue"}`}>
                        {ROLE_LABEL[a.role]}
                      </span>
                    ) : (
                      <Select
                        value={a.role}
                        onChange={(e) => changeRole(a, e.target.value as AdminRole)}
                        style={{ minWidth: 150 }}
                      >
                        <option value="super_admin">Super admin</option>
                        <option value="sales">Sales</option>
                        <option value="technician">Technician</option>
                      </Select>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${a.status === "active" ? "badge-green" : "badge-red"}`}>
                      {a.status}
                    </span>
                  </td>
                  <td>
                    {dateShort(a.createdAt)}
                    {a.createdByName ? <div className="cell-sub">by {a.createdByName}</div> : null}
                  </td>
                  <td className="right">
                    {me?.id === a.id ? (
                      <span className="muted">that's you</span>
                    ) : (
                      <Button
                        size="sm"
                        variant={a.status === "active" ? "danger" : "ghost"}
                        onClick={() => toggleStatus(a)}
                      >
                        {a.status === "active" ? "Disable" : "Enable"}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {items.length === 0 ? <Empty title="No admin accounts yet" /> : null}
      </Card>

      {creating ? (
        <CreateAdminModal
          onClose={() => setCreating(false)}
          onDone={(email, password) => {
            setCreating(false);
            setFreshPassword(password ? { email, password } : null);
            load();
          }}
        />
      ) : null}
    </>
  );
}

function CreateAdminModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (email: string, password: string | null) => void;
}) {
  const [form, setForm] = useState({ email: "", fullName: "", role: "sales", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await api.post<{ admin: Admin; temporaryPassword: string | null }>("/admins", {
        email: form.email,
        fullName: form.fullName,
        role: form.role,
        password: form.password || undefined,
      });
      toast("Admin account created", "success");
      onDone(res.admin.email, res.temporaryPassword);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New admin account"
      sub="The account gets access to this portal only — not the customer apps."
      onClose={onClose}
    >
      <ErrorText>{error}</ErrorText>
      <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
        <Field label="Full name *">
          <Input value={form.fullName} onChange={set("fullName")} required autoFocus />
        </Field>
        <Field label="Email *">
          <Input type="email" value={form.email} onChange={set("email")} required />
        </Field>
        <Field label="Role *">
          <Select value={form.role} onChange={set("role")}>
            <option value="sales">Sales — register businesses, record payments, book setups</option>
            <option value="technician">Technician — complete setups, manage seats</option>
            <option value="super_admin">Super admin — everything, including this screen</option>
          </Select>
        </Field>
        <Field label="Password" help="Leave blank to generate a temporary password (shown once).">
          <Input value={form.password} onChange={set("password")} minLength={8} placeholder="auto-generate" />
        </Field>
        <div className="form-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="ember" disabled={busy}>
            {busy ? "Creating…" : "Create account"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
