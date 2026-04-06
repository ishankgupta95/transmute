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
      setTimeout(onClose, 200);
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  return (
    <div
      className={cn(
        "fixed bottom-6 right-6 z-50 rounded-md px-4 py-3 text-sm font-medium shadow-lg transition-opacity",
        visible ? "opacity-100" : "opacity-0",
        type === "success" && "bg-success text-bg-primary",
        type === "error" && "bg-error text-bg-primary",
        type === "info" && "bg-bg-elevated text-text-primary border border-border",
      )}
    >
      {message}
    </div>
  );
}
