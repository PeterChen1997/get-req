"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { ChatView } from "@/components/chat-view";

const SESSION_STORAGE_KEY = "session_token";

// sessionStorage 只读一次、无变更通知，订阅为空实现
const noopSubscribe = () => () => {};

export default function ChatPage() {
  // 服务端渲染时返回 undefined（加载中），客户端读取 sessionStorage
  const session = useSyncExternalStore(
    noopSubscribe,
    () => sessionStorage.getItem(SESSION_STORAGE_KEY),
    () => undefined
  );

  if (session === undefined) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground">加载中...</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <h1 className="text-xl font-semibold">无效的会话</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            请从首页开始，输入邀请码后进入聊天
          </p>
          <Link href="/" className="mt-4 inline-block text-sm text-primary hover:underline">
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  return <ChatView sessionToken={session} />;
}
