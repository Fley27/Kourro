import type { Dictionary } from "@/app/[lang]/dictionaries";

export function About({ dict }: { dict: Dictionary }) {
  const { about, skills } = dict;

  return (
    <section
      id="about"
      className="scroll-mt-24 border-t border-white/5 bg-white/[0.015] py-20 sm:py-24"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid gap-12 lg:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-blue-400">
              {about.heading}
            </p>
            <p className="mt-6 leading-relaxed text-zinc-300">
              {about.paragraph1}
            </p>
            <p className="mt-4 leading-relaxed text-zinc-400">
              {about.paragraph2}
            </p>

            <dl className="mt-8 space-y-4">
              {about.facts.map((fact) => (
                <div key={fact.label} className="flex flex-col gap-1 sm:flex-row sm:gap-6">
                  <dt className="w-36 shrink-0 text-sm text-zinc-500">
                    {fact.label}
                  </dt>
                  <dd className="text-sm font-medium text-zinc-200">
                    {fact.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-blue-400">
              {skills.heading}
            </p>
            <div className="mt-6 space-y-6">
              {skills.groups.map((group) => (
                <div
                  key={group.name}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
                >
                  <h3 className="text-sm font-semibold text-zinc-200">
                    {group.name}
                  </h3>
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {group.items.map((skill) => (
                      <li
                        key={skill}
                        className="rounded-full border border-white/10 bg-zinc-900 px-3 py-1 text-xs text-zinc-300"
                      >
                        {skill}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
