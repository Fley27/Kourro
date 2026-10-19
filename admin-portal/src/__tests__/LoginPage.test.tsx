import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

const mockAuthStore: any = {
  status: "signedout",
  admin: null,
  accessToken: null,
  error: null,
  signIn: jest.fn(() => Promise.resolve({ ok: true })),
};
const mockNavigate = jest.fn();

jest.mock("../lib/authStore", () => ({
  useAuthStore: () => mockAuthStore,
}));

jest.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
  Link: ({ children, to }: any) => <a data-to={String(to)}>{children}</a>,
  Navigate: () => null,
}));

import LoginPage from "../pages/LoginPage";

describe("LoginPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthStore.status = "signedout";
    mockAuthStore.admin = null;
    mockAuthStore.error = null;
    mockAuthStore.signIn.mockResolvedValue({ ok: true });
    mockNavigate.mockReset();
  });

  it("renders the sign-in form", () => {
    const { container } = render(<LoginPage />);
    expect(container.querySelector('input[type="email"]')).toBeDefined();
    expect(container.querySelectorAll("input")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /sign in/i })).toBeDefined();
  });

  it("calls signIn and navigates home on successful submit", async () => {
    const { container } = render(<LoginPage />);
    const inputs = container.querySelectorAll("input");
    const emailInput = inputs[0] as HTMLInputElement;
    const passwordInput = inputs[1] as HTMLInputElement;
    fireEvent.change(emailInput, { target: { value: "you@kourro.com" } });
    fireEvent.change(passwordInput, { target: { value: "secret" } });
    fireEvent.submit(screen.getByRole("button", { name: /sign in/i }).closest("form")!);
    await waitFor(() => expect(mockAuthStore.signIn).toHaveBeenCalledWith("you@kourro.com", "secret"));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true }));
  });

  it("shows an error when sign-in fails", async () => {
    mockAuthStore.signIn.mockResolvedValue({ ok: false, error: "bad credentials" });
    mockAuthStore.error = "bad credentials";
    const { container } = render(<LoginPage />);
    const inputs = container.querySelectorAll("input");
    const emailInput = inputs[0] as HTMLInputElement;
    const passwordInput = inputs[1] as HTMLInputElement;
    fireEvent.change(emailInput, { target: { value: "you@kourro.com" } });
    fireEvent.change(passwordInput, { target: { value: "wrong" } });
    fireEvent.submit(screen.getByRole("button", { name: /sign in/i }).closest("form")!);
    await waitFor(() => expect(screen.getByText(/bad credentials/i)).toBeDefined());
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
