import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { tools, getToolBySlug } from "@/data/tools";
import { faqs, PRIVACY_FAQ } from "@/data/faqs";
import { getToolMetadata, getHowToSteps } from "@/lib/seo/tool-metadata";
import { ToolPageLayout } from "@/components/tools/ToolPageLayout";
import { ToolClient } from "@/components/tools/ToolClient";

export async function generateStaticParams() {
  return tools.map((tool) => ({ slug: tool.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return getToolMetadata(slug);
}

export default async function ToolPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const tool = getToolBySlug(slug);
  if (!tool) notFound();

  const toolFaqs = [...(faqs[slug] ?? []), PRIVACY_FAQ];

  return (
    <ToolPageLayout
      tool={tool}
      howToSteps={getHowToSteps(tool.toolType)}
      faqs={toolFaqs}
      aboutText={tool.aboutText}
    >
      <ToolClient tool={tool} />
    </ToolPageLayout>
  );
}
