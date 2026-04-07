import type { FAQ } from "@/data/faqs";

const BASE_URL = "https://transmute.tools";

export function generateHowToSchema(toolName: string, steps: string[]) {
  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: `How to use ${toolName}`,
    step: steps.map((text, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      text,
    })),
  };
}

export function generateFAQSchema(faqs: FAQ[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}

export function generateSoftwareAppSchema(
  toolName: string,
  description: string,
  slug: string,
) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: toolName,
    description,
    url: `${BASE_URL}/${slug}`,
    applicationCategory: "UtilitiesApplication",
    operatingSystem: "Any (browser-based)",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    browserRequirements: "Requires a modern web browser with WebAssembly support",
  };
}
