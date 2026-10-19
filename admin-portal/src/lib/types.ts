export type AdminRole = "super_admin" | "sales" | "technician";

export type Admin = {
  id: string;
  email: string;
  fullName: string;
  role: AdminRole;
  status?: "active" | "disabled";
  createdAt?: string;
  createdByName?: string | null;
};

export type Tier = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  interval: "monthly" | "yearly";
  baseSeats: number;
  seatPriceCents: number;
  maxStores: number | null;
  features: Record<string, unknown>;
  isActive: boolean;
  sortOrder: number;
  businessCount: number;
  subscriptionCount: number;
  createdAt?: string;
  updatedAt?: string;
};

export type SubscriptionInfo = {
  id: string;
  tierId: string;
  status: "active" | "expired" | "cancelled";
  startedAt: string;
  currentPeriodStart: string;
  renewsAt: string;
  interval: "monthly" | "yearly";
  currency: string;
  tierPriceCents: number;
  seatPriceCents: number;
  baseSeats: number;
  extraSeats: number;
  totalSeats: number;
};

export type PipelineStatus =
  | "prospect"
  | "paid"
  | "setup_scheduled"
  | "setup_complete"
  | "cancelled";

export type BusinessSummary = {
  id: string;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  businessType: string | null;
  tierId: string | null;
  tierName: string | null;
  pipelineStatus: PipelineStatus;
  setupAppointmentAt: string | null;
  setupCompletedAt: string | null;
  ownerEmail: string | null;
  ownerUserId: string | null;
  organizationId: string | null;
  notes: string | null;
  createdAt: string;
  subscription: SubscriptionInfo | null;
  renewingSoon: boolean;
  openCents: number;
  balanceCents: number;
  owedCents: number;
  creditCents: number;
};

export type Invoice = {
  id: string;
  number: string;
  businessId: string;
  subscriptionId: string | null;
  kind: "initial" | "renewal" | "seat_proration" | "tier_upgrade" | "manual";
  description: string;
  amountCents: number;
  status: "open" | "paid" | "void";
  periodStart: string | null;
  periodEnd: string | null;
  dueAt: string | null;
  createdAt: string;
};

export type Payment = {
  id: string;
  businessId: string;
  amountCents: number;
  currency: string;
  method: string;
  reference: string | null;
  notes: string | null;
  receivedAt: string;
  appliedCents: number;
  createdAt: string;
};

export type ActivityItem = {
  id: string;
  businessId: string | null;
  businessName: string | null;
  adminId: string | null;
  adminName: string | null;
  actorType: "admin" | "owner" | "system";
  actorLabel: string;
  action: string;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type Notification = {
  id: string;
  adminId: string;
  type: string;
  title: string;
  body: string;
  businessId: string | null;
  businessName: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

export type BusinessDetail = BusinessSummary & {
  invoices: Invoice[];
  payments: Payment[];
  activity: ActivityItem[];
  staff: { profileAccounts: number | null; employeeRecords: number | null };
};

export type Dashboard = {
  totals: {
    total: number;
    prospect: number;
    paid: number;
    setupScheduled: number;
    setupComplete: number;
    active: number;
    expired: number;
    renewingSoon: number;
  };
  money: {
    owedCents: number;
    creditCents: number;
    collectedMonthCents: number;
    currency: string;
  };
  upcomingAppointments: {
    id: string;
    name: string;
    setupAppointmentAt: string;
    ownerEmail: string | null;
  }[];
  recentActivity: ActivityItem[];
  unreadNotifications: number;
  renewingSoonDays: number;
};

export type SeatAddResult = {
  seatsAdded: number;
  proratedCents: number;
  totalSeats: number;
  paidSeats: number;
  renewsAt: string;
  balanceCents: number;
};

export type RenewResult = {
  renewsAt: string;
  previousRenewsAt: string;
  periodStart: string;
  amountCents: number;
  invoiceNumber: string | null;
  balanceCents: number;
};

export type TierChangeResult = {
  changed: boolean;
  tierId: string;
  tierName: string;
  previousTierName: string;
  tierPriceCents: number;
  upgradeCents: number;
  baseSeats: number;
  totalSeats: number;
  paidSeats: number;
  renewsAt: string;
  balanceCents: number;
};
