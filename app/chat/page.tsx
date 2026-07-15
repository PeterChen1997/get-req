"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ChatView } from "@/components/chat-view";

function ChatContent() {
  const searchParams = useSearchParams();
  const session = searchParams.get("session");

  if (!session) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <h1 className="text-xl font-semibold">无效的会话</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            请从首页开始，输入邀请码后进入聊天
          </p>
          <a href="/" className="mt-4 inline-block text-sm text-primary hover:underline">
            返回首页
          </a>
        </div>
      </div>
    );
  }

  return <ChatView sessionToken={session} />;
}

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center">
          <p className="text-muted-foreground">加载中...</p>
        </div>
      }
    >
      <ChatContent />
    </Suspense>
  );
}
