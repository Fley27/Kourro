import { notFound } from "next/navigation";
import { About } from "@/components/site/about";
import { Contact } from "@/components/site/contact";
import { Footer } from "@/components/site/footer";
import { Header } from "@/components/site/header";
import { Hero } from "@/components/site/hero";
import { Services } from "@/components/site/services";
import { Work } from "@/components/site/work";
import { isLocale } from "@/lib/i18n";
import { getDictionary } from "./dictionaries";

export default async function HomePage(props: PageProps<"/[lang]">) {
  const { lang } = await props.params;

  if (!isLocale(lang)) notFound();

  const dict = getDictionary(lang);

  return (
    <>
      <Header dict={dict} locale={lang} />
      <main>
        <Hero dict={dict} />
        <Services dict={dict} />
        <About dict={dict} />
        <Work dict={dict} />
        <Contact dict={dict} />
      </main>
      <Footer dict={dict} locale={lang} />
    </>
  );
}
