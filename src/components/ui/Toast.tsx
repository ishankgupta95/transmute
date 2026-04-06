"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils/cn";

interface ToastProps {
  message: string;
  type?: "success" | "error" | "info";
  duration?: number;
  onClose: () => void;
}

export function Toast({ message, type = "info", duration = 3000, onClose }: ToastProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onClose, 300);
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  return (
    <div
      className={cn(
        "fixed bottom-6 right-6 z-50 rounded-md px-5 py-3.5 text-sm font-medium shadow-2xl transition-all duration-300",
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2",
        type === "success" && "bg-success text-bg-primary",
        type === "error" && "bg-error text-bg-primary",
        type === "info" && "bg-bg-elevated text-text-primary border border-border",
      )}
    >
      {message}
    </div>
  );
}
