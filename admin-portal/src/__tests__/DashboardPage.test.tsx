import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";

const mockAuthStore: any = {
  status: "signedin",
  admin: { role: "super_admin" },
  accessToken: "token",
  error: null,
  signIn: jest.fn(),
};

jest.mock("../lib/authStore", () => ({
  useAuthStore: () => mockAuthStore,
}));

jest.mock("../lib/api", () => ({
  api: { get: jest.fn() },
}));
import { api } from "../lib/api";

jest.mock("react-router-dom", () => ({
  useNavigate: () => jest.fn(),
  Link: ({ children, to }: any) => <a data-to={String(to)}>{children}</a>,
  Navigate: () => null,
}));

import DashboardPage from "../pages/DashboardPage";

const dashboard = {
  totals: { total: 5, active: 3, renewingSoon: 1, expired: 0, prospect: 0, paid: 0, setupScheduled: 0, setupComplete: 0 },
  money: { owedCents: 0, currency: "USD", collectedMonthCents: 0, creditCents: 0 },
  upcomingAppointments: [],
  recentActivity: [],
  renewingSoonDays: 14,
};

describe("DashboardPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.get.mockReset();
    mockAuthStore.status = "signedin";
    mockAuthStore.admin = { role: "super_admin" };
  });

  it("shows a loading spinner while fetching", async () => {
    api.get.mockReturnValue(new Promise(() => {}));
    render(<DashboardPage />);
    expect(screen.getByLabelText(/loading/i)).toBeDefined();
  });

  it("renders dashboard stats once data loads", async () => {
    api.get.mockResolvedValue(dashboard);
    render(<DashboardPage />);
    await waitFor(() => expect(screen.getByText(/5 businesses on the platform/)).toBeDefined());
    expect(screen.getByText("Active")).toBeDefined();
    expect(screen.getByText("3")).toBeDefined();
    expect(screen.getByText("Renewing soon")).toBeDefined();
    expect(screen.getByText("1")).toBeDefined();
    expect(screen.getByText("Expired")).toBeDefined();
    expect(api.get).toHaveBeenCalledWith("/dashboard");
  });

  it("shows an error message when the fetch fails", async () => {
    api.get.mockRejectedValue(new Error("down"));
    render(<DashboardPage />);
    await waitFor(() => expect(screen.getByText(/down/i)).toBeDefined());
  });

  it("hides the register business button for non-sales roles", async () => {
    mockAuthStore.admin = { role: "cashier" };
    api.get.mockResolvedValue(dashboard);
    render(<DashboardPage />);
    await waitFor(() => expect(screen.getByText(/5 businesses on the platform/)).toBeDefined());
    expect(screen.queryByText(/register business/i)).toBeNull();
  });
});
