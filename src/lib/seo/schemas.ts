import type { FAQ } from "@/data/faqs";

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
