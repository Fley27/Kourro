// Staff invite — owner/admin creates a team member end-to-end in the cloud:
// a GoTrue auth user (so the profiles FK and login both exist), the profiles
// roster row, and an SMTP email with the generated temp password. The
// password is generated here, returned ONCE to the creator, and never stored
// in plaintext (GoTrue keeps only the hash).
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { supabase, isMockMode } from "../index.js";
import { requireAuth } from "../auth.js";
import { mailer, SMTP_FROM } from "../mailer.js";

// Unambiguous alphabet: no 0/O/1/l — the creator reads the password off a
// screen and the new hire types it on a register keyboard.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

function randomFrom(alphabet: string, length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

const CREATE_ROLES = ["admin", "manager", "cashier", "associate", "cook"] as const;

/** Mirrors the app's canAddRole: owner may create any non-owner role; admin
 * may create manager/cook/associate/cashier (never another admin). */
function canCreateRole(authRole: string, target: string): boolean {
  if (!(CREATE_ROLES as readonly string[]).includes(target)) return false;
  if (authRole === "owner") return true;
  if (authRole === "admin") return target !== "admin";
  return false;
}

export default async function staffRoutes(app: FastifyInstance) {
  app.post("/invite", async (req, reply) => {
    const body = (req.body ?? {}) as {
      store_id?: string;
      email?: string;
      full_name?: string;
      role?: string;
    };
    const storeId = String(body.store_id ?? "");
    if (!storeId) return reply.status(400).send({ error: "store_id required" });

    const auth = await requireAuth(req, reply, { storeId });
    if (!auth) return;
    if (isMockMode) {
      return reply.status(503).send({ error: "mock_mode", message: "staff invite needs a real Supabase" });
    }
    if (!["owner", "admin"].includes(auth.role)) {
      return reply.status(403).send({ error: "forbidden", message: "se owner/admin ka ajoute anplwaye" });
    }

    const email = String(body.email ?? "").trim().toLowerCase();
    const fullName = String(body.full_name ?? "").trim();
    const role = String(body.role ?? "").trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reply.status(400).send({ error: "invalid_email" });
    }
    if (!fullName) return reply.status(400).send({ error: "full_name required" });
    if (!canCreateRole(auth.role, role)) {
      return reply.status(403).send({ error: "forbidden_role", message: "ou pa gen dwa kreye wòl sa a" });
    }

    // One login per email — a second invite would mint an unusable duplicate.
    const { data: taken } = await supabase
      .from("profiles").select("id").eq("email", email).maybeSingle();
    const { data: authTaken } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const emailInAuth = (authTaken?.users ?? []).some(u => String(u.email ?? "").toLowerCase() === email);
    if (taken || emailInAuth) {
      return reply.status(409).send({ error: "email_exists", message: "imel sa a gen kont deja" });
    }

    const password = randomFrom(ALPHABET, 12);
    const pin = randomFrom("23456789", 4);

    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, role },
    });
    if (createErr || !created?.user) {
      req.log.error({ err: createErr }, "staff invite: auth user create failed");
      return reply.status(502).send({ error: "auth_create_failed", message: createErr?.message ?? "no user" });
    }
    const userId = created.user.id;

    const { error: profileErr } = await supabase.from("profiles").insert({
      id: userId,
      email,
      full_name: fullName,
      role,
      pin_code: pin,
      organization_id: auth.organizationId,
      language: "ht",
    });
    if (profileErr) {
      // Roll the half-created login back so a retry isn't blocked by it.
      try { await supabase.auth.admin.deleteUser(userId); } catch {}
      req.log.error({ err: profileErr }, "staff invite: profiles insert failed");
      return reply.status(502).send({ error: "profile_insert_failed", message: profileErr.message });
    }

    // Email is best-effort: an unreachable SMTP must not lose the account —
    // the creator still gets the password in the response to hand over.
    let emailSent = false;
    const transport = mailer();
    if (transport) {
      try {
        await transport.sendMail({
          from: SMTP_FROM(),
          to: email,
          subject: "Kont anplwaye ou — Kourro",
          text:
            `Bònjou ${fullName},\n\n` +
            `Yon kont anplwaye kreye pou ou nan Kourro.\n\n` +
            `Imel: ${email}\n` +
            `Modpas tanporè: ${password}\n\n` +
            `Konekte ak imel ak modpas sa a, epi chanje modpas ou apre premye koneksyon an.\n`,
        });
        emailSent = true;
      } catch (e) {
        req.log.warn({ err: e }, "staff invite: SMTP send failed — password returned to creator only");
      }
    } else {
      req.log.warn("[staff] SMTP_HOST unset — invite email skipped");
    }

    // Password returned ONCE, never logged.
    return { ok: true, user_id: userId, password, pin, email_sent: emailSent };
  });
}
