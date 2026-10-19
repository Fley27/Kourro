import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuthStore } from "../lib/authStore";
import { BrandLogo, Button, ErrorText, Field, Input } from "../components/ui";

export default function LoginPage() {
  const { status, signIn, error } = useAuthStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  if (status === "signedin") return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const result = await signIn(email, password);
    setBusy(false);
    if (result.ok) navigate("/", { replace: true });
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-brand">
          <BrandLogo className="brand-logo" eager />
          <span>Admin portal</span>
        </div>

        <div className="card card-pad">
          <ErrorText>{error}</ErrorText>
          <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
            <Field label="Email">
              <Input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@kourro.com"
                required
                autoFocus
              />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
            <Button type="submit" variant="ember" block disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </div>

        <p className="muted" style={{ textAlign: "center", fontSize: 12, marginTop: 14 }}>
          Staff accounts are created by the super admin.
        </p>
      </div>
    </div>
  );
}
