"use client";

import { useState } from "react";
import { InviteForm } from "@/components/invite-form";
import { UserInfoForm } from "@/components/user-info-form";

export default function Home() {
  const [step, setStep] = useState<"invite" | "info">("invite");
  const [inviteCode, setInviteCode] = useState("");

  return (
    <div className="flex flex-1 items-center justify-center">
      <main className="flex flex-col items-center gap-8 px-6 py-16 w-full max-w-md">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            需求收集助手
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            通过 AI 聊天，将您的想法梳理成专业的需求文档
          </p>
        </div>

        {step === "invite" ? (
          <InviteForm
            onVerified={(code) => {
              setInviteCode(code);
              setStep("info");
            }}
          />
        ) : (
          <UserInfoForm inviteCode={inviteCode} />
        )}
      </main>
    </div>
  );
}
