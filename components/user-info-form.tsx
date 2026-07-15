"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function UserInfoForm({ inviteCode }: { inviteCode: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [contactType, setContactType] = useState("wechat");
  const [contactInfo, setContactInfo] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !contactInfo.trim()) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/user-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inviteCode,
          name: name.trim(),
          contactInfo: contactInfo.trim(),
          contactType,
        }),
      });

      const data = await res.json();
      if (data.sessionToken) {
        router.push(`/chat?session=${data.sessionToken}`);
      } else {
        setError(data.error || "提交失败，请重试");
      }
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  const contactPlaceholder: Record<string, string> = {
    email: "your@email.com",
    phone: "13800138000",
    wechat: "your_wechat_id",
  };

  const contactLabel: Record<string, string> = {
    email: "邮箱",
    phone: "手机号",
    wechat: "微信号",
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 w-full max-w-sm">
      <div>
        <label htmlFor="name" className="block text-sm font-medium mb-1.5">
          姓名
        </label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="您的姓名"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          disabled={loading}
          autoFocus
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1.5">联系方式类型</label>
        <div className="flex gap-3">
          {(["wechat", "phone", "email"] as const).map((type) => (
            <label key={type} className="flex items-center gap-1.5 text-sm cursor-pointer">
              <input
                type="radio"
                name="contactType"
                value={type}
                checked={contactType === type}
                onChange={() => setContactType(type)}
                className="accent-primary"
              />
              {contactLabel[type]}
            </label>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="contact" className="block text-sm font-medium mb-1.5">
          {contactLabel[contactType]}
        </label>
        <input
          id="contact"
          type="text"
          value={contactInfo}
          onChange={(e) => setContactInfo(e.target.value)}
          placeholder={contactPlaceholder[contactType]}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          disabled={loading}
        />
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading || !name.trim() || !contactInfo.trim()}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "提交中..." : "开始需求澄清"}
      </button>

      <p className="text-xs text-muted-foreground text-center">
        您的联系方式仅用于需求反馈联系，不会用于其他用途
      </p>
    </form>
  );
}
