import type { MetadataRoute } from "next";
import { tools } from "@/data/tools";
import { categories } from "@/data/categories";

export const dynamic = "force-static";

const BASE_URL = "https://transmute.tools";

export default function sitemap(): MetadataRoute.Sitemap {
  const toolPages = tools.map((tool) => ({
    url: `${BASE_URL}/${tool.slug}`,
    lastModified: new Date(),
    changeFrequency: "monthly" as const,
    priority: 0.8,
  }));

  const categoryPages = categories.map((cat) => ({
    url: `${BASE_URL}/${cat.slug}`,
    lastModified: new Date(),
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));

  return [
    {
      url: BASE_URL,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1.0,
    },
    ...categoryPages,
    {
      // The full crawlable index — one link per registered tool.
      url: `${BASE_URL}/all-tools`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.7,
    },
    ...toolPages,
    {
      url: `${BASE_URL}/about`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${BASE_URL}/privacy`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.2,
    },
    {
      // The offline opt-in. Indexable for the same reason /licenses is: the
      // privacy policy promises engines are only ever stored "at your explicit
      // request, one named engine at a time, with its size shown before the
      // download starts", and this is the page where that request is made.
      url: `${BASE_URL}/offline-access`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      // Third-party notices. Low priority to crawl, but it must be reachable
      // and indexable: the FFmpeg source offer is only an offer if it can be
      // found without knowing the URL already.
      url: `${BASE_URL}/licenses`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.2,
    },
  ];
}
