"use client";

import {
  ComposerAddAttachment,
  ComposerAttachments,
  UserMessageAttachments,
} from "@/components/assistant-ui/attachment";
import { ThreadFollowupSuggestions } from "@/components/assistant-ui/follow-up-suggestions";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import {
  Reasoning,
  ReasoningContent,
  ReasoningRoot,
  ReasoningText,
  ReasoningTrigger,
} from "@/components/assistant-ui/reasoning";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import {
  ToolGroupContent,
  ToolGroupRoot,
  ToolGroupTrigger,
} from "@/components/assistant-ui/tool-group";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  AuiIf,
  type AssistantState,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  groupPartByType,
  MessagePrimitive,
  SuggestionPrimitive,
  type ThreadMessage as AuiThreadMessage,
  ThreadPrimitive,
  type ToolCallMessagePartComponent,
  useAuiState,
} from "@assistant-ui/react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CalendarClockIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CoffeeIcon,
  CopyIcon,
  DownloadIcon,
  DumbbellIcon,
  ExternalLinkIcon,
  FileTextIcon,
  GraduationCapIcon,
  HomeIcon,
  type LucideIcon,
  MessageCircleIcon,
  MicIcon,
  MoreHorizontalIcon,
  PartyPopperIcon,
  PencilIcon,
  RefreshCwIcon,
  SquareIcon,
  WalletIcon,
} from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type FC,
  type PropsWithChildren,
} from "react";

export type ThreadGroupPart = MessagePrimitive.GroupedParts.GroupPart;

/**
 * Optional component overrides for the thread. `AssistantMessage` and
 * `Welcome` replace whole sections; the remaining slots override how the
 * assistant message renders tool calls and part groups. Tool UIs registered
 * by name (toolkit `render`, `useAssistantDataUI`) take precedence over
 * `ToolFallback`.
 */
export type ThreadComponents = {
  AssistantMessage?: ComponentType | undefined;
  Welcome?: ComponentType | undefined;
  ToolFallback?: ToolCallMessagePartComponent | undefined;
  ToolGroup?:
    | ComponentType<PropsWithChildren<{ group: ThreadGroupPart }>>
    | undefined;
  ReasoningGroup?:
    | ComponentType<PropsWithChildren<{ group: ThreadGroupPart }>>
    | undefined;
};

export type ThreadProps = {
  components?: ThreadComponents | undefined;
};

const EMPTY_COMPONENTS: ThreadComponents = {};

const ThreadComponentsContext =
  createContext<ThreadComponents>(EMPTY_COMPONENTS);

// Startup exposes a loading placeholder thread; treat it as a new chat so
// the composer mounts centered. Loads after startup keep the docked layout.
const isNewChatView = (s: AssistantState) =>
  s.thread.messages.length === 0 &&
  (!s.thread.isLoading || s.threads.isLoading);

export const Thread: FC<ThreadProps> = ({ components = EMPTY_COMPONENTS }) => {
  const isEmpty = useAuiState(isNewChatView);

  return (
    <ThreadComponentsContext.Provider value={components}>
      <ThreadRoot isEmpty={isEmpty} />
    </ThreadComponentsContext.Provider>
  );
};

// submitDocument 成功后本次沟通即结束：从消息里解析出文档链接与运营者微信，
// 用来关闭输入框并展示收尾提示。
type CompletionInfo = {
  notionUrl: string | null;
  operatorWechat: string | null;
};

const readCompletion = (result: unknown): CompletionInfo | null => {
  if (typeof result !== "object" || result === null) return null;
  if (!("success" in result) || result.success !== true) return null;
  const notionUrl =
    "notionUrl" in result && typeof result.notionUrl === "string"
      ? result.notionUrl
      : null;
  const operatorWechat =
    "operatorWechat" in result && typeof result.operatorWechat === "string"
      ? result.operatorWechat
      : null;
  return { notionUrl, operatorWechat };
};

const findCompletion = (
  messages: readonly AuiThreadMessage[],
): CompletionInfo | null => {
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.content) {
      if (part.type !== "tool-call" || part.toolName !== "submitDocument")
        continue;
      const info = readCompletion(part.result);
      if (info) return info;
    }
  }
  return null;
};

const ThreadRoot: FC<{ isEmpty: boolean }> = ({ isEmpty }) => {
  const { Welcome = ThreadWelcome } = useContext(ThreadComponentsContext);
  const messages = useAuiState((s) => s.thread.messages);
  const completion = useMemo(() => findCompletion(messages), [messages]);

  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root bg-background @container flex h-full flex-col"
      style={{
        ["--thread-max-width" as string]: "44rem",
        ["--composer-bg" as string]:
          "color-mix(in oklab, var(--color-muted) 30%, var(--color-background))",
        ["--composer-radius" as string]: "1.5rem",
        ["--composer-padding" as string]: "8px",
      }}
    >
      <ThreadPrimitive.Viewport
        turnAnchor="top"
        data-slot="aui_thread-viewport"
        className="relative flex flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth"
      >
        <div
          className={cn(
            "mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col px-4 pt-4",
            isEmpty && "justify-center",
          )}
        >
          <AuiIf condition={isNewChatView}>
            <Welcome />
          </AuiIf>

          <div
            data-slot="aui_message-group"
            className="mb-14 flex flex-col gap-y-6 empty:hidden"
          >
            <ThreadPrimitive.Messages>
              {() => <ThreadMessage />}
            </ThreadPrimitive.Messages>
          </div>

          <ThreadPrimitive.ViewportFooter
            className={cn(
              "aui-thread-viewport-footer bg-background flex flex-col gap-4 overflow-visible pb-4 md:pb-6",
              !isEmpty &&
                "sticky bottom-0 mt-auto rounded-t-(--composer-radius)",
            )}
          >
            <ThreadScrollToBottom />
            {completion ? (
              <ConversationEnded info={completion} />
            ) : (
              <>
                <ThreadFollowupSuggestions />
                <Composer />
                <AuiIf
                  condition={(s) => isNewChatView(s) && s.composer.isEmpty}
                >
                  <ThreadSuggestions />
                </AuiIf>
              </>
            )}
          </ThreadPrimitive.ViewportFooter>
        </div>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};

const ThreadMessage: FC = () => {
  const { AssistantMessage: AssistantMessageComponent = AssistantMessage } =
    useContext(ThreadComponentsContext);
  const role = useAuiState((s) => s.message.role);
  const isEditing = useAuiState((s) => s.message.composer.isEditing);

  if (isEditing) return <EditComposer />;
  if (role === "user") return <UserMessage />;
  return <AssistantMessageComponent />;
};

const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom render={<TooltipIconButton tooltip="Scroll to bottom" variant="outline" className="aui-thread-scroll-to-bottom dark:border-border dark:bg-background dark:hover:bg-accent absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible" />}><ArrowDownIcon /></ThreadPrimitive.ScrollToBottom>
  );
};

type WelcomeValue = {
  icon: LucideIcon;
  title: string;
  description: string;
};

// 需求被接受后我给到的实打实的东西——引导用户开口的三个理由。
const WELCOME_VALUES: readonly WelcomeValue[] = [
  {
    icon: WalletIcon,
    title: "$100 AI 调用额度",
    description: "需求通过后，我掏真金白银的额度，帮你把想法真正跑起来。",
  },
  {
    icon: CalendarClockIcon,
    title: "7 天一对一沟通",
    description: "需求接受后 7 天内，随时找我一对一打磨、细化每个细节。",
  },
  {
    icon: FileTextIcon,
    title: "专业需求文档",
    description: "边聊边产出，最后交给你一份能直接开工的需求文档。",
  },
];

type WelcomeCase = {
  icon: LucideIcon;
  role: string;
  title: string;
  outcome: string;
};

// TODO(sonny): 换成真实案例。以下为贴近个人的示例，替换文案即可。
const WELCOME_CASES: readonly WelcomeCase[] = [
  {
    icon: DumbbellIcon,
    role: "健身教练",
    title: "训练后放松助手",
    outcome: "学员练完发一句练了哪个部位，自动生成对应的放松拉伸方案。",
  },
  {
    icon: CoffeeIcon,
    role: "独立咖啡店",
    title: "每日备料参谋",
    outcome: "结合天气和客流，每天开店前生成一份该备多少料的清单。",
  },
  {
    icon: GraduationCapIcon,
    role: "少儿英语老师",
    title: "家长周报生成器",
    outcome: "把零散的课堂记录，一键变成家长看得懂的学习进度周报。",
  },
  {
    icon: HomeIcon,
    role: "民宿房东",
    title: "咨询自动应答",
    outcome: "多平台的常见问题自动回复，只有需要转人工时才提醒我。",
  },
];

const ThreadWelcome: FC = () => {
  return (
    <div className="aui-thread-welcome-root mb-6 flex flex-col items-center px-4 text-center">
      <div className="fade-in slide-in-from-bottom-1 animate-in fill-mode-both flex items-center gap-2.5 duration-200">
        <Avatar size="sm">
          <AvatarFallback className="bg-primary text-primary-foreground text-[0.65rem] font-semibold">
            SC
          </AvatarFallback>
        </Avatar>
        <span className="text-muted-foreground text-sm">
          <span className="text-foreground font-medium">Sonny Chen</span>
          <span className="text-border mx-1.5">·</span>
          AI Builder
        </span>
      </div>

      <h1 className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both mt-4 text-2xl font-semibold duration-200">
        聊聊你的产品想法
      </h1>
      <p className="fade-in slide-in-from-bottom-2 animate-in fill-mode-both text-muted-foreground mt-3 max-w-md text-sm leading-relaxed duration-200">
        直接把脑海里模糊的需求说出来即可，我会主动追问细节，帮你一步步梳理成一份专业的需求文档。想法一旦被接受，下面这些就都归你。
      </p>

      <div className="fade-in slide-in-from-bottom-2 animate-in fill-mode-both mt-7 grid w-full max-w-2xl grid-cols-1 gap-3 duration-300 sm:grid-cols-3">
        {WELCOME_VALUES.map((value) => (
          <div
            key={value.title}
            className="border-border/60 bg-muted/20 flex flex-col items-center gap-2 rounded-2xl border p-4 text-center"
          >
            <div className="bg-muted text-foreground flex size-9 items-center justify-center rounded-full">
              <value.icon className="size-4.5" />
            </div>
            <span className="text-foreground text-sm font-medium">
              {value.title}
            </span>
            <span className="text-muted-foreground text-xs leading-relaxed">
              {value.description}
            </span>
          </div>
        ))}
      </div>

      <WelcomeCases />
    </div>
  );
};

const CASE_ROTATE_MS = 4000;

const WelcomeCases: FC = () => {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setActive((prev) => (prev + 1) % WELCOME_CASES.length);
    }, CASE_ROTATE_MS);
    return () => clearInterval(timer);
  }, []);

  const current = WELCOME_CASES.at(active);
  if (!current) return null;
  const CaseIcon = current.icon;

  return (
    <div className="fade-in slide-in-from-bottom-3 animate-in fill-mode-both mt-8 flex w-full max-w-2xl flex-col items-center duration-500">
      <span className="text-muted-foreground/70 text-xs tracking-wide">
        过往帮别人做过的
      </span>
      <div className="border-border/60 bg-muted/20 mt-3 flex w-full items-center gap-3.5 rounded-2xl border px-4 py-3.5 text-left">
        <div className="bg-muted text-foreground flex size-10 shrink-0 items-center justify-center rounded-full">
          <CaseIcon className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span className="text-foreground text-sm font-medium">
              {current.title}
            </span>
            <span className="text-muted-foreground/70 text-xs">
              给{current.role}
            </span>
          </div>
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
            {current.outcome}
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-1.5">
        {WELCOME_CASES.map((item, index) => (
          <button
            key={item.title}
            type="button"
            aria-label={`查看案例：${item.title}`}
            onClick={() => setActive(index)}
            className={cn(
              "h-1.5 rounded-full transition-all duration-300",
              index === active
                ? "bg-foreground/70 w-4"
                : "bg-muted-foreground/30 hover:bg-muted-foreground/50 w-1.5",
            )}
          />
        ))}
      </div>
    </div>
  );
};

const ThreadSuggestions: FC = () => {
  return (
    <div className="aui-thread-welcome-suggestions flex w-full flex-wrap items-center justify-center gap-2 px-4">
      <ThreadPrimitive.Suggestions>
        {() => <ThreadSuggestionItem />}
      </ThreadPrimitive.Suggestions>
    </div>
  );
};

const ThreadSuggestionItem: FC = () => {
  return (
    <div className="aui-thread-welcome-suggestion-display fade-in slide-in-from-bottom-2 animate-in fill-mode-both duration-200">
      <SuggestionPrimitive.Trigger send render={<Button variant="ghost" className="aui-thread-welcome-suggestion text-foreground hover:bg-muted border-border/60 h-auto gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-normal whitespace-nowrap transition-colors" />}><SuggestionPrimitive.Title className="aui-thread-welcome-suggestion-text-1" /><SuggestionPrimitive.Description className="aui-thread-welcome-suggestion-text-2 empty:hidden" /></SuggestionPrimitive.Trigger>
    </div>
  );
};

const Composer: FC = () => {
  return (
    <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
      <ComposerPrimitive.AttachmentDropzone render={<div data-slot="aui_composer-shell" className="border-border/60 data-[dragging=true]:border-ring focus-within:border-border dark:border-muted-foreground/15 dark:focus-within:border-muted-foreground/30 flex w-full flex-col gap-2 rounded-(--composer-radius) border bg-(--composer-bg) p-(--composer-padding) shadow-[0_4px_16px_-8px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] transition-[border-color,box-shadow] focus-within:shadow-[0_6px_24px_-8px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.05)] data-[dragging=true]:border-dashed data-[dragging=true]:bg-[color-mix(in_oklab,var(--color-accent)_50%,var(--color-background))] dark:shadow-none" />}><ComposerAttachments /><ComposerPrimitive.Input
                      placeholder="说说你的想法…"
                      className="aui-composer-input caret-primary placeholder:text-muted-foreground/80 max-h-32 min-h-10 w-full resize-none bg-transparent px-2.5 py-1 text-base outline-none"
                      rows={1}
                      autoFocus
                      enterKeyHint="send"
                      aria-label="Message input"
                    /><ComposerAction /></ComposerPrimitive.AttachmentDropzone>
    </ComposerPrimitive.Root>
  );
};

// 需求提交且文档生成后展示：关闭输入框，引导查看文档、致谢，并留下微信联系方式。
const ConversationEnded: FC<{ info: CompletionInfo }> = ({ info }) => {
  return (
    <div className="aui-conversation-ended fade-in slide-in-from-bottom-2 animate-in fill-mode-both border-border/60 bg-muted/20 flex flex-col items-center gap-3 rounded-(--composer-radius) border px-5 py-6 text-center duration-300">
      <div className="bg-muted text-foreground flex size-10 items-center justify-center rounded-full">
        <PartyPopperIcon className="size-5" />
      </div>

      <div className="space-y-1">
        <p className="text-foreground text-sm font-medium">
          需求已收到，本次沟通就先聊到这儿 🙏
        </p>
        <p className="text-muted-foreground text-xs leading-relaxed">
          谢谢你把想法讲清楚，文档我已经帮你整理好了，随时可以点开看看。
        </p>
      </div>

      {info.notionUrl && (
        <a
          href={info.notionUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors"
        >
          <FileTextIcon className="size-4" />
          查看我的需求文档
          <ExternalLinkIcon className="size-3.5" />
        </a>
      )}

      {info.operatorWechat && (
        <p className="text-muted-foreground/80 flex flex-wrap items-center justify-center gap-x-1.5 text-xs">
          <MessageCircleIcon className="size-3.5 shrink-0" />
          有任何问题，随时微信找我：
          <span className="text-foreground font-medium">
            {info.operatorWechat}
          </span>
        </p>
      )}
    </div>
  );
};

const ComposerAction: FC = () => {
  return (
    <div className="aui-composer-action-wrapper relative flex items-center justify-between">
      <ComposerAddAttachment />
      <div className="flex items-center gap-1.5">
        <AuiIf condition={(s) => s.thread.capabilities.dictation}>
          <AuiIf condition={(s) => s.composer.dictation == null}>
            <ComposerPrimitive.Dictate render={<TooltipIconButton tooltip="Voice input" side="bottom" type="button" variant="ghost" size="icon" className="aui-composer-dictate size-7 rounded-full" aria-label="Start voice input" />}><MicIcon className="aui-composer-dictate-icon size-4" /></ComposerPrimitive.Dictate>
          </AuiIf>
          <AuiIf condition={(s) => s.composer.dictation != null}>
            <ComposerPrimitive.StopDictation render={<TooltipIconButton tooltip="Stop dictation" side="bottom" type="button" variant="ghost" size="icon" className="aui-composer-stop-dictation text-destructive size-7 rounded-full" aria-label="Stop voice input" />}><SquareIcon className="aui-composer-stop-dictation-icon size-3.5 animate-pulse fill-current" /></ComposerPrimitive.StopDictation>
          </AuiIf>
        </AuiIf>
        <AuiIf condition={(s) => !s.thread.isRunning}>
          <ComposerPrimitive.Send render={<TooltipIconButton tooltip="Send message" side="bottom" type="button" variant="default" size="icon" className="aui-composer-send size-7 rounded-full" aria-label="Send message" />}><ArrowUpIcon className="aui-composer-send-icon size-4.5" /></ComposerPrimitive.Send>
        </AuiIf>
        <AuiIf condition={(s) => s.thread.isRunning}>
          <ComposerPrimitive.Cancel render={<Button type="button" variant="default" size="icon" className="aui-composer-cancel size-7 rounded-full" aria-label="Stop generating" />}><SquareIcon className="aui-composer-cancel-icon size-3.5 fill-current" /></ComposerPrimitive.Cancel>
        </AuiIf>
      </div>
    </div>
  );
};

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="aui-message-error-root border-destructive bg-destructive/10 text-destructive dark:bg-destructive/5 mt-2 rounded-md border p-3 text-sm dark:text-red-200">
        <ErrorPrimitive.Message className="aui-message-error-message line-clamp-2" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

const AssistantMessage: FC = () => {
  const {
    ToolFallback: ToolFallbackComponent = ToolFallback,
    ToolGroup,
    ReasoningGroup,
  } = useContext(ThreadComponentsContext);

  const ACTION_BAR_PT = "pt-1.5";
  // Keep the action bar inside the contained root's paint box, then cancel its reserved space in flow.
  const ACTION_BAR_HEIGHT = `min-h-7.5 ${ACTION_BAR_PT}`;

  return (
    <MessagePrimitive.Root
      data-slot="aui_assistant-message-root"
      data-role="assistant"
      className="fade-in slide-in-from-bottom-1 animate-in relative -mb-7.5 pb-7.5 duration-150 [contain-intrinsic-size:auto_200px] [content-visibility:auto]"
    >
      <div
        data-slot="aui_assistant-message-content"
        className="text-foreground px-2 leading-relaxed wrap-break-word"
      >
        <MessagePrimitive.GroupedParts
          groupBy={groupPartByType({
            reasoning: ["group-chainOfThought", "group-reasoning"],
            "tool-call": ["group-chainOfThought", "group-tool"],
            "standalone-tool-call": [],
          })}
        >
          {({ part, children }) => {
            switch (part.type) {
              case "group-chainOfThought":
                return <div data-slot="aui_chain-of-thought">{children}</div>;
              case "group-tool":
                if (ToolGroup) {
                  return <ToolGroup group={part}>{children}</ToolGroup>;
                }
                return (
                  <ToolGroupRoot variant="ghost">
                    <ToolGroupTrigger
                      count={part.indices.length}
                      active={part.status.type === "running"}
                    />
                    <ToolGroupContent>{children}</ToolGroupContent>
                  </ToolGroupRoot>
                );
              case "group-reasoning": {
                if (ReasoningGroup) {
                  return (
                    <ReasoningGroup group={part}>{children}</ReasoningGroup>
                  );
                }
                const running = part.status.type === "running";
                return (
                  <ReasoningRoot streaming={running}>
                    <ReasoningTrigger active={running} />
                    <ReasoningContent aria-busy={running}>
                      <ReasoningText>{children}</ReasoningText>
                    </ReasoningContent>
                  </ReasoningRoot>
                );
              }
              case "text":
                return <MarkdownText />;
              case "reasoning":
                return <Reasoning {...part} />;
              case "tool-call":
                return part.toolUI ?? <ToolFallbackComponent {...part} />;
              case "data":
                return part.dataRendererUI;
              case "indicator":
                return (
                  <span
                    data-slot="aui_assistant-message-indicator"
                    className="animate-pulse font-sans"
                    aria-label="Assistant is working"
                  >
                    {"●"}
                  </span>
                );
              default:
                return null;
            }
          }}
        </MessagePrimitive.GroupedParts>
        <MessageError />
      </div>

      <div
        data-slot="aui_assistant-message-footer"
        className={cn("ms-2 flex items-center", ACTION_BAR_HEIGHT)}
      >
        <BranchPicker />
        <AssistantActionBar />
      </div>
    </MessagePrimitive.Root>
  );
};

const AssistantActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-assistant-action-bar-root text-muted-foreground animate-in fade-in col-start-3 row-start-2 -ms-1 flex gap-1 duration-200"
    >
      <ActionBarPrimitive.Copy render={<TooltipIconButton tooltip="Copy" />}><AuiIf condition={(s) => s.message.isCopied}>
                      <CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out" />
                    </AuiIf><AuiIf condition={(s) => !s.message.isCopied}>
                      <CopyIcon className="animate-in zoom-in-75 fade-in duration-150" />
                    </AuiIf></ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload render={<TooltipIconButton tooltip="Refresh" />}><RefreshCwIcon /></ActionBarPrimitive.Reload>
      <ActionBarMorePrimitive.Root>
        <ActionBarMorePrimitive.Trigger render={<TooltipIconButton tooltip="More" className="data-[state=open]:bg-accent" />}><MoreHorizontalIcon /></ActionBarMorePrimitive.Trigger>
        <ActionBarMorePrimitive.Content
          side="bottom"
          align="start"
          sideOffset={6}
          className="aui-action-bar-more-content bg-popover/95 text-popover-foreground data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:animate-out data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] overflow-hidden rounded-xl border p-1.5 shadow-lg backdrop-blur-sm"
        >
          <ActionBarPrimitive.ExportMarkdown render={<ActionBarMorePrimitive.Item className="aui-action-bar-more-item hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none" />}><DownloadIcon className="size-4" />Export as Markdown
                              </ActionBarPrimitive.ExportMarkdown>
        </ActionBarMorePrimitive.Content>
      </ActionBarMorePrimitive.Root>
    </ActionBarPrimitive.Root>
  );
};

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_user-message-root"
      className="fade-in slide-in-from-bottom-1 animate-in grid auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 duration-150 [contain-intrinsic-size:auto_200px] [content-visibility:auto] [&:where(>*)]:col-start-2"
      data-role="user"
    >
      <UserMessageAttachments />

      <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
        <div className="aui-user-message-content peer bg-muted text-foreground rounded-xl px-4 py-2 wrap-break-word empty:hidden">
          <MessagePrimitive.Parts />
        </div>
        <div className="aui-user-action-bar-wrapper absolute start-0 top-1/2 -translate-x-full -translate-y-1/2 pe-2 peer-empty:hidden rtl:translate-x-full">
          <UserActionBar />
        </div>
      </div>

      <BranchPicker
        data-slot="aui_user-branch-picker"
        className="col-span-full col-start-1 row-start-3 -me-1 justify-end"
      />
    </MessagePrimitive.Root>
  );
};

const UserActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-user-action-bar-root flex flex-col items-end"
    >
      <ActionBarPrimitive.Edit render={<TooltipIconButton tooltip="Edit" className="aui-user-action-edit" />}><PencilIcon /></ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

const EditComposer: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_edit-composer-wrapper"
      className="flex flex-col px-2 [contain-intrinsic-size:auto_200px] [content-visibility:auto]"
    >
      <ComposerPrimitive.Root className="aui-edit-composer-root border-border/60 dark:border-muted-foreground/15 ms-auto flex w-full max-w-[85%] flex-col rounded-(--composer-radius) border bg-(--composer-bg) shadow-[0_4px_16px_-8px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] dark:shadow-none">
        <ComposerPrimitive.Input
          className="aui-edit-composer-input text-foreground min-h-14 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-base outline-none"
          autoFocus
        />
        <div className="aui-edit-composer-footer mx-2.5 mb-2.5 flex items-center gap-1.5 self-end">
          <ComposerPrimitive.Cancel render={<Button variant="ghost" size="sm" className="h-8 rounded-full px-3.5" />}>Cancel
                              </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send render={<Button size="sm" className="h-8 rounded-full px-3.5" />}>Update
                              </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
};

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({
  className,
  ...rest
}) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn(
        "aui-branch-picker-root text-muted-foreground -ms-2 me-2 inline-flex items-center text-xs",
        className,
      )}
      {...rest}
    >
      <BranchPickerPrimitive.Previous render={<TooltipIconButton tooltip="Previous" />}><ChevronLeftIcon /></BranchPickerPrimitive.Previous>
      <span className="aui-branch-picker-state font-medium">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next render={<TooltipIconButton tooltip="Next" />}><ChevronRightIcon /></BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};
