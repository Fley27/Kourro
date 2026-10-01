import type { Dictionary } from "@/app/[lang]/dictionaries";

export function Hero({ dict }: { dict: Dictionary }) {
  const { hero } = dict;

  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_70%_0%,rgba(37,99,235,0.18),transparent_70%)]"
      />
      <div className="relative mx-auto max-w-6xl px-4 pb-20 pt-16 sm:px-6 sm:pb-24 sm:pt-24">
        <div className="grid items-start gap-12 lg:grid-cols-[1.25fr_1fr]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {hero.badge}
            </span>

            <p className="mt-6 text-lg text-zinc-400">{hero.greeting}</p>
            <h1 className="mt-1 text-4xl font-semibold tracking-tight sm:text-5xl">
              {hero.name}
            </h1>
            <p className="mt-3 bg-gradient-to-r from-blue-400 via-sky-400 to-red-400 bg-clip-text text-2xl font-medium text-transparent sm:text-3xl">
              {hero.role}
            </p>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-zinc-400">
              {hero.intro}
            </p>
            <p className="mt-4 text-sm text-zinc-500">{hero.location}</p>

            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href="#contact"
                className="rounded-full bg-blue-600 px-6 py-3 text-sm font-medium text-white transition hover:bg-blue-500"
              >
                {hero.ctaPrimary}
              </a>
              <a
                href="#work"
                className="rounded-full border border-white/15 px-6 py-3 text-sm font-medium text-zinc-200 transition hover:border-white/40 hover:bg-white/5"
              >
                {hero.ctaSecondary}
              </a>
            </div>

            <dl className="mt-12 grid grid-cols-2 gap-6 border-t border-white/10 pt-8 sm:grid-cols-4">
              {hero.stats.map((stat) => (
                <div key={stat.label}>
                  <dt className="sr-only">{stat.label}</dt>
                  <dd className="text-2xl font-semibold text-white">
                    {stat.value}
                  </dd>
                  <dd className="mt-1 text-xs text-zinc-500">{stat.label}</dd>
                </div>
              ))}
            </dl>
          </div>

          <aside className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 shadow-2xl shadow-blue-950/40 sm:p-8">
            <div className="flex items-center gap-4">
              <span className="grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 text-xl font-bold text-white">
                FM
              </span>
              <div>
                <p className="font-semibold">{hero.name}</p>
                <p className="text-sm text-zinc-400">{hero.role}</p>
              </div>
            </div>

            <ul className="mt-6 space-y-3 text-sm">
              {dict.about.facts.map((fact) => (
                <li
                  key={fact.label}
                  className="flex items-start justify-between gap-4 border-b border-white/5 pb-3 last:border-0"
                >
                  <span className="text-zinc-500">{fact.label}</span>
                  <span className="text-right text-zinc-200">{fact.value}</span>
                </li>
              ))}
            </ul>

            <a
              href="#contact"
              className="mt-6 block rounded-xl border border-blue-500/40 bg-blue-500/10 px-4 py-3 text-center text-sm font-medium text-blue-300 transition hover:bg-blue-500/20"
            >
              {hero.ctaPrimary}
            </a>
          </aside>
        </div>
      </div>
    </section>
  );
}
