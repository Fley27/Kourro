import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import type { ActivityItem } from "../lib/types";
import { timeAgo } from "../lib/format";
import { Card, Empty, Loading } from "../components/ui";

const ACTION_STYLE: Record<string, string> = {
  "seats.added.self_service": "badge-ember",
  "seats.added.by_admin": "badge-blue",
  "subscription.renewed": "badge-ember",
  "subscription.upgraded": "badge-blue",
  "subscription.upgraded.self_service": "badge-ember",
  "payment.recorded": "badge-green",
  "setup.completed": "badge-green",
  "subscription.expired": "badge-red",
  "subscription.reactivated": "badge-blue",
  "business.registered": "badge-gray",
  "appointment.booked": "badge-amber",
};

export default function ActivityPage() {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get<{ items: ActivityItem[] }>("/activity?limit=120")
      .then((res) => setItems(res.items))
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error-text">{error}</div>;
  if (!items) return <Loading />;

  return (
    <Card>
      <div className="card-head">
        <div>
          <h3>Activity log</h3>
          <div className="sub">
            Append-only trail of every significant account action — including approval-free
            self-service ones.
          </div>
        </div>
      </div>
      {items.length === 0 ? (
        <Empty title="No activity yet" />
      ) : (
        <div className="rows timeline">
          {items.map((item) => (
            <div key={item.id} className="row-item">
              <div className="grow">
                <div className="title">
                  {item.businessId && item.businessName ? (
                    <Link className="link-btn" to={`/businesses/${item.businessId}`}>
                      {item.summary}
                    </Link>
                  ) : (
                    item.summary
                  )}
                </div>
                <div className="sub" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span className={`badge plain ${ACTION_STYLE[item.action] ?? "badge-gray"}`}>
                    {item.action}
                  </span>
                  <span>{item.actorLabel}</span>
                  <span className="muted">({item.actorType})</span>
                </div>
              </div>
              <div className="when">{timeAgo(item.createdAt)}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
