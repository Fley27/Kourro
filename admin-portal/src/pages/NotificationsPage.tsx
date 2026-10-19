import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import type { Notification } from "../lib/types";
import { timeAgo } from "../lib/format";
import { Button, Card, Empty, Loading, toast } from "../components/ui";

export default function NotificationsPage() {
  const [items, setItems] = useState<Notification[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const res = await api.get<{ items: Notification[]; unread: number }>("/notifications?limit=80");
      setItems(res.items);
      setUnread(res.unread);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const markRead = async (id: string) => {
    try {
      await api.post(`/notifications/${id}/read`);
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const markAll = async () => {
    try {
      await api.post("/notifications/read-all");
      toast("All notifications marked read", "success");
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  if (error) return <div className="error-text">{error}</div>;
  if (!items) return <Loading />;

  return (
    <Card>
      <div className="card-head">
        <div>
          <h3>Notifications</h3>
          <div className="sub">
            {unread > 0 ? `${unread} unread` : "You're all caught up"} — every significant action
            fires one of these.
          </div>
        </div>
        <div className="spacer" />
        <Button size="sm" variant="ghost" onClick={markAll} disabled={unread === 0}>
          Mark all read
        </Button>
      </div>

      {items.length === 0 ? (
        <Empty title="No notifications" />
      ) : (
        <div className="rows">
          {items.map((n) => (
            <div key={n.id} className={`row-item ${n.readAt ? "" : "unread"}`}>
              {n.readAt ? null : <span className="dot" />}
              <div className="grow">
                <div className="title">{n.title}</div>
                <div className="sub">{n.body}</div>
                {n.link ? (
                  <Link className="link-btn" to={n.link} style={{ fontSize: 12, marginTop: 4, display: "inline-block" }}>
                    Open →
                  </Link>
                ) : null}
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                <div className="when">{timeAgo(n.createdAt)}</div>
                {n.readAt ? (
                  <span className="badge badge-gray plain">read</span>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => markRead(n.id)}>
                    Mark read
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
