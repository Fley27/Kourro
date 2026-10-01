import type { Dictionary } from "@/app/[lang]/dictionaries";
import { githubUrl, linkedinUrl } from "@/lib/site";

const whatsappUrl = "https://wa.me/509000000000";

export function Contact({ dict }: { dict: Dictionary }) {
  const { contact } = dict;

  const channels = [
    {
      label: contact.emailLabel,
      value: contact.email,
      href: `mailto:${contact.email}`,
    },
    {
      label: contact.phoneLabel,
      value: contact.phone,
      href: "tel:+5090000000",
    },
    {
      label: contact.locationLabel,
      value: contact.location,
      href: undefined,
    },
  ];

  return (
    <section
      id="contact"
      className="scroll-mt-24 border-t border-white/5 bg-white/[0.015] py-20 sm:py-24"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid gap-12 lg:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-blue-400">
              {contact.heading}
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              {contact.intro}
            </h2>
            <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {contact.availability}
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href={`mailto:${contact.email}`}
                className="rounded-full bg-blue-600 px-6 py-3 text-sm font-medium text-white transition hover:bg-blue-500"
              >
                {contact.ctaEmail}
              </a>
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-white/15 px-6 py-3 text-sm font-medium text-zinc-200 transition hover:border-white/40 hover:bg-white/5"
              >
                {contact.ctaWhatsApp}
              </a>
              <a
                href={linkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-white/15 px-6 py-3 text-sm font-medium text-zinc-200 transition hover:border-white/40 hover:bg-white/5"
              >
                {contact.ctaLinkedIn}
              </a>
            </div>
          </div>

          <ul className="grid gap-4 self-center">
            {channels.map((channel) => {
              const content = (
                <>
                  <span className="text-xs uppercase tracking-wider text-zinc-500">
                    {channel.label}
                  </span>
                  <span className="mt-1 block font-medium text-zinc-100">
                    {channel.value}
                  </span>
                </>
              );

              return (
                <li key={channel.label}>
                  {channel.href ? (
                    <a
                      href={channel.href}
                      className="block rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-blue-500/40 hover:bg-white/[0.05]"
                    >
                      {content}
                    </a>
                  ) : (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                      {content}
                    </div>
                  )}
                </li>
              );
            })}
            <li>
              <div className="flex gap-3">
                <a
                  href={linkedinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center text-sm font-medium text-zinc-300 transition hover:border-blue-500/40 hover:text-white"
                >
                  LinkedIn
                </a>
                <a
                  href={githubUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center text-sm font-medium text-zinc-300 transition hover:border-blue-500/40 hover:text-white"
                >
                  GitHub
                </a>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
