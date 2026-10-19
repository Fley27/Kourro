// expo-contacts → Contact Picker API (Chromium + Android Chrome).
//
// The shared CustomerForm asks for permissions, then imports
// name/phoneNumbers/emails. Browsers without the Contact Picker report no
// access, which lands on the same "Pa gen aksè" alert native shows when the
// user declines. The picker itself is the permission grant, so
// requestPermissionsAsync is optimistic when the API exists.
export const Fields = {
  AllFields: "*",
  Name: "name",
  FirstName: "firstName",
  MiddleName: "middleName",
  LastName: "lastName",
  PhoneNumbers: "phoneNumbers",
  Emails: "emails",
  Company: "company",
  JobTitle: "jobTitle",
  Addresses: "addresses",
  Birthday: "birthday",
  Note: "note",
  Image: "image",
} as const;

type ContactPickerContact = {
  name?: string[];
  tel?: string[];
  email?: string[];
};

function picker(): { select: (props: string[], options?: unknown) => Promise<ContactPickerContact[]> } | null {
  const nav = navigator as Navigator & {
    contacts?: { select?: (props: string[], options?: unknown) => Promise<ContactPickerContact[]> };
  };
  if (nav.contacts && typeof nav.contacts.select === "function") {
    return nav.contacts as {
      select: (props: string[], options?: unknown) => Promise<ContactPickerContact[]>;
    };
  }
  return null;
}

export async function isAvailableAsync(): Promise<boolean> {
  return picker() !== null;
}

export async function requestPermissionsAsync(): Promise<{
  status: "granted" | "denied";
  granted: boolean;
  canAskAgain: boolean;
  expires: "never";
}> {
  const available = picker() !== null;
  return {
    status: available ? "granted" : "denied",
    granted: available,
    canAskAgain: false,
    expires: "never",
  };
}

export async function getPermissionsAsync(): Promise<{
  status: "granted" | "denied";
  granted: boolean;
  canAskAgain: boolean;
  expires: "never";
}> {
  return requestPermissionsAsync();
}

export async function getContactsAsync(options?: {
  fields?: string[];
  pageSize?: number;
  pageOffset?: number;
  sort?: string;
  name?: string;
}): Promise<{ data: any[]; hasNextPage: boolean; hasPreviousPage: boolean; total: number }> {
  const empty = { data: [], hasNextPage: false, hasPreviousPage: false, total: 0 };
  const api = picker();
  if (!api) return empty;

  const fields = options?.fields ?? [];
  const props: string[] = ["name"];
  if (fields.includes(Fields.PhoneNumbers) || fields.includes(Fields.AllFields)) props.push("tel");
  if (fields.includes(Fields.Emails) || fields.includes(Fields.AllFields)) props.push("email");

  try {
    const picked = await api.select(props, { multiple: true });
    const data = (picked ?? []).map((contact, index) => ({
      id: `web-${index}`,
      name: Array.isArray(contact.name) ? contact.name[0] ?? "" : String(contact.name ?? ""),
      phoneNumbers: (contact.tel ?? []).map((number) => ({ number })),
      emails: (contact.email ?? []).map((email) => ({ email })),
    }));
    return { data, hasNextPage: false, hasPreviousPage: false, total: data.length };
  } catch {
    // User cancelled the picker (AbortError) — treat as "no selection".
    return empty;
  }
}

export async function getContactByIdAsync(): Promise<null> {
  return null;
}

export async function addContactAsync(): Promise<never> {
  throw new Error("Adding contacts is not supported on web");
}

export default { Fields, isAvailableAsync, requestPermissionsAsync, getPermissionsAsync, getContactsAsync };
