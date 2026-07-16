"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

// 仅用于区分服务端/客户端渲染，无外部状态可订阅
const noopSubscribe = () => () => {};

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  // 挂载前 resolvedTheme 不可用，先渲染占位避免 hydration 闪烁
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );

  const isDark = resolvedTheme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      aria-label={isDark ? "切换到浅色模式" : "切换到深色模式"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {mounted && isDark ? <Moon /> : <Sun />}
    </Button>
  );
}
