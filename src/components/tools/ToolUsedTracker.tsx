"use client";

import { useEffect } from "react";
import { trackEvent } from "@/lib/utils/analytics";

export function ToolUsedTracker({ slug, category }: { slug: string; category: string }) {
  useEffect(() => {
    trackEvent({
      action: "tool_used",
      category,
      label: slug,
    });
  }, [slug, category]);

  return null;
}
