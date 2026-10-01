import Link from "next/link";
import type { Dictionary } from "@/app/[lang]/dictionaries";
import { locales, type Locale } from "@/lib/i18n";

const navItems = [
  { key: "about", href: "#about" },
  { key: "services", href: "#services" },
  { key: "work", href: "#work" },
  { key: "contact", href: "#contact" },
] as const;

const localeLabels: Record<Locale, string> = {
  en: "EN",
  fr: "FR",
  es: "ES",
};

export function Header({
  dict,
  locale,
}: {
  dict: Dictionary;
  locale: Locale;
}) {
  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-zinc-950/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <Link
          href={`/${locale}`}
          className="flex items-center gap-2 font-semibold tracking-tight"
        >
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-blue-600 text-sm font-bold text-white">
            FM
          </span>
          <span className="hidden sm:inline">{dict.header.brand}</span>
        </Link>

        <nav className="order-3 -mx-1 flex w-full items-center justify-center gap-1 overflow-x-auto text-sm sm:order-none sm:w-auto sm:justify-end">
          {navItems.map((item) => (
            <a
              key={item.key}
              href={item.href}
              className="whitespace-nowrap rounded-full px-3 py-1.5 text-zinc-300 transition hover:bg-white/10 hover:text-white"
            >
              {dict.header.nav[item.key]}
            </a>
          ))}
        </nav>

        <div
          className="flex items-center gap-1 rounded-full border border-white/10 p-1 text-xs font-medium"
          aria-label={dict.header.language}
        >
          {locales.map((candidate) => (
            <Link
              key={candidate}
              href={`/${candidate}`}
              hrefLang={candidate}
              aria-current={candidate === locale ? "page" : undefined}
              className={
                candidate === locale
                  ? "rounded-full bg-blue-600 px-2.5 py-1 text-white"
                  : "rounded-full px-2.5 py-1 text-zinc-400 transition hover:text-white"
              }
            >
              {localeLabels[candidate]}
            </Link>
          ))}
        </div>
      </div>
    </header>
  );
}
