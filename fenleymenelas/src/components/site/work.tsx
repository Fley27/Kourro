import type { Dictionary } from "@/app/[lang]/dictionaries";

export function Work({ dict }: { dict: Dictionary }) {
  const { work, experience } = dict;

  return (
    <section
      id="work"
      className="scroll-mt-24 border-t border-white/5 py-20 sm:py-24"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <p className="text-xs font-medium uppercase tracking-widest text-blue-400">
          {work.heading}
        </p>
        <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
          {work.intro}
        </h2>

        <div className="mt-12 grid gap-6 sm:grid-cols-2">
          {work.items.map((item) => (
            <article
              key={item.title}
              className="group flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-blue-500/40 hover:bg-white/[0.05]"
            >
              <div className="flex items-center justify-between gap-4">
                <h3 className="text-lg font-semibold">{item.title}</h3>
                <span className="text-xs text-zinc-500">{item.year}</span>
              </div>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-zinc-400">
                {item.description}
              </p>
              <ul className="mt-5 flex flex-wrap gap-2">
                {item.tags.map((tag) => (
                  <li
                    key={tag}
                    className="rounded-full border border-white/10 bg-zinc-900 px-2.5 py-1 text-[11px] text-zinc-400"
                  >
                    {tag}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>

        <div className="mt-20">
          <p className="text-xs font-medium uppercase tracking-widest text-blue-400">
            {experience.heading}
          </p>
          <ol className="mt-8 border-l border-white/10 pl-6 sm:pl-8">
            {experience.items.map((item) => (
              <li key={item.role + item.period} className="relative pb-8 last:pb-0">
                <span
                  aria-hidden
                  className="absolute -left-[31px] top-1.5 h-3 w-3 rounded-full border-2 border-blue-500 bg-zinc-950 sm:-left-[39px]"
                />
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h3 className="text-base font-semibold">{item.role}</h3>
                  <p className="text-sm text-zinc-400">{item.company}</p>
                  <p className="ml-auto text-xs text-zinc-500">{item.period}</p>
                </div>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
                  {item.description}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
