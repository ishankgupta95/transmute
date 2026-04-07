import type { FAQ } from "@/data/faqs";
import {
  generateHowToSchema,
  generateFAQSchema,
  generateSoftwareAppSchema,
} from "@/lib/seo/schemas";

interface ToolSchemaProps {
  toolName: string;
  toolDescription: string;
  toolSlug: string;
  howToSteps?: string[];
  faqs?: FAQ[];
}

export function ToolSchema({
  toolName,
  toolDescription,
  toolSlug,
  howToSteps,
  faqs,
}: ToolSchemaProps) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            generateSoftwareAppSchema(toolName, toolDescription, toolSlug),
          ),
        }}
      />
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
