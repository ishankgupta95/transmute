type GtagEvent = {
  action: string;
  category?: string;
  label?: string;
  value?: number;
};

export function trackEvent({ action, category, label, value }: GtagEvent) {
  if (typeof window !== "undefined" && typeof window.gtag === "function") {
    window.gtag("event", action, {
      event_category: category,
      event_label: label,
      value,
    });
  }
}
