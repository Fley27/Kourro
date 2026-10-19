import { sql, type Db } from "../db.js";

export type NotifyInput = {
  type: string;
  title: string;
  body: string;
  businessId?: string | null;
  link?: string | null;
  /** Skip the admin who performed the action (their own event). */
  excludeAdminId?: string | null;
};

/**
 * Fans out one notification per active admin, so every teammate has their own
 * unread state. Fired for every significant account action — including
 * approval-free ones like self-service seat additions, so the team can follow
 * up if something looks off.
 */
export async function notifyTeam(input: NotifyInput, db: Db = sql): Promise<void> {
  const businessId = input.businessId ?? null;
  const link = input.link ?? null;
  const exclude = input.excludeAdminId ?? null;

  if (exclude) {
    await db`
      insert into adm_notifications (admin_id, type, title, body, business_id, link)
      select id, ${input.type}, ${input.title}, ${input.body}, ${businessId}, ${link}
      from admin_users
      where status = 'active' and id <> ${exclude}`;
  } else {
    await db`
      insert into adm_notifications (admin_id, type, title, body, business_id, link)
      select id, ${input.type}, ${input.title}, ${input.body}, ${businessId}, ${link}
      from admin_users
      where status = 'active'`;
  }
}
