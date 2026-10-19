import { sql, type Db } from "../db.js";

export type ActorType = "admin" | "owner" | "system";

export type ActivityInput = {
  action: string;
  summary: string;
  actorType: ActorType;
  actorLabel: string;
  businessId?: string | null;
  adminId?: string | null;
  metadata?: Record<string, unknown>;
};

/** Append-only. Every significant account action lands here. */
export async function logActivity(input: ActivityInput, db: Db = sql): Promise<void> {
  await db`
    insert into adm_activity_log (business_id, admin_id, actor_type, actor_label, action, summary, metadata)
    values (
      ${input.businessId ?? null},
      ${input.adminId ?? null},
      ${input.actorType},
      ${input.actorLabel},
      ${input.action},
      ${input.summary},
      ${JSON.stringify(input.metadata ?? {})}::jsonb
    )`;
}
