"use client";

import { useMemo } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import {
  useChatRuntime,
  AssistantChatTransport,
} from "@assistant-ui/react-ai-sdk";
import { Thread } from "@/components/assistant-ui/thread";

export function ChatView({ sessionToken }: { sessionToken: string }) {
  const transport = useMemo(
    () =>
      new AssistantChatTransport({
        api: "/api/chat",
        body: { sessionToken },
      }),
    [sessionToken]
  );

  const runtime = useChatRuntime({ transport });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="h-dvh">
        <Thread />
      </div>
    </AssistantRuntimeProvider>
  );
}
