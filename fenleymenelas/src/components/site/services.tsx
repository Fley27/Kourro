import type { Dictionary } from "@/app/[lang]/dictionaries";

const icons = ["</>", "▢", "◈", "⚙"] as const;

export function Services({ dict }: { dict: Dictionary }) {
  const { services } = dict;

  return (
    <section
      id="services"
      className="scroll-mt-24 border-t border-white/5 py-20 sm:py-24"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <p className="text-xs font-medium uppercase tracking-widest text-blue-400">
          {services.heading}
        </p>
        <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
          {services.intro}
        </h2>

        <div className="mt-12 grid gap-6 sm:grid-cols-2">
          {services.items.map((item, index) => (
            <article
              key={item.title}
              className="group rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-blue-500/40 hover:bg-white/[0.05]"
            >
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-600/15 text-lg text-blue-400 transition group-hover:bg-blue-600/25">
                {icons[index % icons.length]}
              </span>
              <h3 className="mt-5 text-lg font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                {item.description}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
