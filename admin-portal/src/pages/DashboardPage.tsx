import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import type { Dashboard } from "../lib/types";
import { dateTime, money, timeAgo } from "../lib/format";
import { useAuthStore } from "../lib/authStore";
import { Button, Card, CardHead, Empty, Loading, Spinner } from "../components/ui";

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const admin = useAuthStore((s) => s.admin);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    api
      .get<Dashboard>("/dashboard")
      .then((res) => alive && setData(res))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <div className="error-text">{error}</div>;
  if (!data) return <Loading />;

  const { totals, money: cash, upcomingAppointments, recentActivity, renewingSoonDays } = data;
  const canRegister = admin?.role === "sales" || admin?.role === "super_admin";

  return (
    <>
      <div className="toolbar">
        <div className="muted">
          {totals.total} businesses on the platform • renewing-soon window: {renewingSoonDays} days
        </div>
        <div className="spacer" />
        {canRegister ? (
          <Button variant="ember" onClick={() => navigate("/businesses/new")}>
            + Register business
          </Button>
        ) : null}
        <Button variant="ghost" onClick={() => navigate("/businesses")}>
          Open pipeline
        </Button>
      </div>

      <div className="grid cols-4 mb">
        <Card className="stat accent-green">
          <div className="label">Active</div>
          <div className="value">{totals.active}</div>
          <div className="hint">subscriptions billing</div>
        </Card>
        <Card className="stat accent-amber">
          <div className="label">Renewing soon</div>
          <div className="value">{totals.renewingSoon}</div>
          <div className="hint">within {renewingSoonDays} days</div>
        </Card>
        <Card className="stat accent-red">
          <div className="label">Expired</div>
          <div className="value">{totals.expired}</div>
          <div className="hint">past renewal grace</div>
        </Card>
        <Card className="stat accent-ember">
          <div className="label">Outstanding balance</div>
          <div className="value" style={{ fontSize: 22 }}>
            {money(cash.owedCents, cash.currency)}
          </div>
          <div className="hint">
            collected this month: {money(cash.collectedMonthCents, cash.currency)}
            {cash.creditCents > 0 ? ` • credits: ${money(cash.creditCents, cash.currency)}` : ""}
          </div>
        </Card>
      </div>

      <div className="grid cols-4 mb">
        <Card className="stat">
          <div className="label">Prospects</div>
          <div className="value">{totals.prospect}</div>
          <div className="hint">registered, not paid yet</div>
        </Card>
        <Card className="stat">
          <div className="label">Paid</div>
          <div className="value">{totals.paid}</div>
          <div className="hint">awaiting setup appointment</div>
        </Card>
        <Card className="stat">
          <div className="label">Setup booked</div>
          <div className="value">{totals.setupScheduled}</div>
          <div className="hint">technician scheduled</div>
        </Card>
        <Card className="stat">
          <div className="label">Setup complete</div>
          <div className="value">{totals.setupComplete}</div>
          <div className="hint">live on the platform</div>
        </Card>
      </div>

      <div className="grid cols-2">
        <Card>
          <CardHead title="Upcoming setup appointments" sub="Next scheduled on-site / remote setups" />
          {upcomingAppointments.length === 0 ? (
            <Empty title="No appointments booked">Book one from a business detail page.</Empty>
          ) : (
            <div className="rows">
              {upcomingAppointments.map((a) => (
                <Link key={a.id} to={`/businesses/${a.id}`} className="row-item">
                  <div className="grow">
                    <div className="title">{a.name}</div>
                    <div className="sub">{dateTime(a.setupAppointmentAt)}</div>
                  </div>
                  <span className="badge badge-amber">Scheduled</span>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHead
            title="Recent activity"
            sub="Every significant account action is logged"
            right={
              <Link className="link-btn" to="/activity">
                View all
              </Link>
            }
          />
          {recentActivity.length === 0 ? (
            <Empty title="Nothing yet">Actions will show up here as your team works.</Empty>
          ) : (
            <div className="rows timeline">
              {recentActivity.map((item) => (
                <div key={item.id} className="row-item">
                  <div className="grow">
                    <div className="title">{item.summary}</div>
                    <div className="sub mono">{item.action}</div>
                  </div>
                  <div className="when">{timeAgo(item.createdAt)}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
