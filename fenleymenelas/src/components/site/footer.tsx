import Link from "next/link";
import type { Dictionary } from "@/app/[lang]/dictionaries";
import { locales, type Locale } from "@/lib/i18n";

const localeLabels: Record<Locale, string> = {
  en: "English",
  fr: "Français",
  es: "Español",
};

export function Footer({
  dict,
  locale,
}: {
  dict: Dictionary;
  locale: Locale;
}) {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-white/10 py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="font-semibold">{dict.header.brand}</p>
          <p className="mt-1 text-sm text-zinc-500">{dict.footer.tagline}</p>
        </div>

        <div className="flex flex-col items-start gap-3 md:items-end">
          <div className="flex gap-3 text-sm">
            {locales.map((candidate) => (
              <Link
                key={candidate}
                href={`/${candidate}`}
                hrefLang={candidate}
                className={
                  candidate === locale
                    ? "text-blue-400"
                    : "text-zinc-500 transition hover:text-zinc-200"
                }
              >
                {localeLabels[candidate]}
              </Link>
            ))}
          </div>
          <p className="text-xs text-zinc-600">
            © {year} {dict.header.brand}. {dict.footer.rights}
          </p>
        </div>
      </div>
    </footer>
  );
}
