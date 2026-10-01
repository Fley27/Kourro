import Link from "next/link";
import { lang } from "next/root-params";
import { defaultLocale, isLocale } from "@/lib/i18n";
import { getDictionary } from "./dictionaries";

export default async function NotFound() {
  const param = await lang();
  const locale = param && isLocale(param) ? param : defaultLocale;
  const dict = getDictionary(locale);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm font-medium uppercase tracking-widest text-blue-400">
        404
      </p>
      <h1 className="text-3xl font-semibold tracking-tight">
        {dict.notFound.title}
      </h1>
      <p className="max-w-md text-zinc-400">{dict.notFound.text}</p>
      <Link
        href={`/${locale}`}
        className="mt-4 rounded-full bg-blue-600 px-6 py-3 text-sm font-medium text-white transition hover:bg-blue-500"
      >
        {dict.notFound.back}
      </Link>
    </main>
  );
}
