import type { FAQ } from "@/data/faqs";
import { generateHowToSchema, generateFAQSchema } from "@/lib/seo/schemas";

interface ToolSchemaProps {
  toolName: string;
  howToSteps?: string[];
  faqs?: FAQ[];
}

export function ToolSchema({ toolName, howToSteps, faqs }: ToolSchemaProps) {
  return (
    <>
      {howToSteps && howToSteps.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(generateHowToSchema(toolName, howToSteps)),
          }}
        />
      )}
      {faqs && faqs.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(generateFAQSchema(faqs)),
          }}
        />
      )}
    </>
  );
}
