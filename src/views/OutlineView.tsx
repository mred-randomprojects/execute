import type { RefObject } from "react";
import type { ISODate, Task } from "../types";
import type { TodayProgress, ViewKind } from "../selectors";
import { formatLong } from "../store/dates";
import { CaptureBar } from "../components/CaptureBar";
import { TaskRow } from "../components/TaskRow";
import { InboxZero } from "../components/InboxZero";

const TITLES: Record<ViewKind, string> = {
  today: "Today",
  backlog: "Backlog",
  all: "All tasks",
};

const PLACEHOLDERS: Record<ViewKind, string> = {
  today: "Add a task for today…",
  backlog: "Capture something for later…",
  all: "Capture a task…",
};

function Subtitle({
  view,
  progress,
}: {
  view: ViewKind;
  progress: TodayProgress;
}) {
  if (view === "today") {
    if (progress.total > 0 && progress.remaining === 0) {
      return <span className="text-good">Inbox zero — every task done.</span>;
    }
    return (
      <span>
        {progress.remaining} to go
        {progress.total > 0 ? ` · ${progress.done}/${progress.total} done` : ""}
      </span>
    );
  }
  if (view === "backlog") return <span>Things to plan into a day.</span>;
  return <span>Your whole outline. Press t to plan a task for today.</span>;
}

function EmptyState({ view }: { view: ViewKind }) {
  const msg: Record<ViewKind, string> = {
    today: "Nothing planned for today. Add one above, or plan from the backlog.",
    backlog: "Backlog is clear.",
    all: "No tasks yet — capture your first above.",
  };
  return (
    <div className="px-2 py-10 text-center text-[14px] text-ink-faint">
      {msg[view]}
    </div>
  );
}

export function OutlineView({
  view,
  today,
  filtered,
  progress,
  captureRef,
  onAdd,
}: {
  view: ViewKind;
  today: ISODate;
  filtered: Task[];
  progress: TodayProgress;
  captureRef: RefObject<HTMLInputElement>;
  onAdd: (raw: string) => void;
}) {
  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-10 py-8">
      <header className="mb-5 border-b border-line pb-4">
        {view === "today" && (
          <div className="eyebrow mb-1.5">{formatLong(today)}</div>
        )}
        <h1 className="font-serif text-[32px] font-medium leading-none tracking-tight text-ink">
          {TITLES[view]}
        </h1>
        <p className="mt-2 text-[14px] text-ink-soft">
          <Subtitle view={view} progress={progress} />
        </p>
      </header>

      <div className="mb-4">
        <CaptureBar
          inputRef={captureRef}
          placeholder={PLACEHOLDERS[view]}
          onAdd={onAdd}
        />
      </div>

      {view === "today" && progress.total > 0 && progress.remaining === 0 && (
        <div className="mb-4">
          <InboxZero total={progress.total} />
        </div>
      )}

      <div className="-mx-2 flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <EmptyState view={view} />
        ) : (
          filtered.map((t) => <TaskRow key={t.id} task={t} depth={0} />)
        )}
      </div>
    </div>
  );
}
