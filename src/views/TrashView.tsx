import type { TaskId, TrashedTask } from "../types";

export function TrashView({
  trash,
  onRestore,
  onPurge,
  onEmpty,
}: {
  trash: TrashedTask[];
  onRestore: (id: TaskId) => void;
  onPurge: (id: TaskId) => void;
  onEmpty: () => void;
}) {
  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-10 py-8">
      <header className="mb-5 flex items-end justify-between border-b border-line pb-4">
        <div>
          <h1 className="font-serif text-[32px] font-medium leading-none tracking-tight text-ink">
            Trash
          </h1>
          <p className="mt-2 text-[14px] text-ink-soft">
            Deleted tasks are kept here. Restore them, or remove them for good.
          </p>
        </div>
        {trash.length > 0 && (
          <button
            onClick={onEmpty}
            className="rounded-sm border border-bad/40 px-2.5 py-1.5 text-[12px] font-medium text-bad hover:bg-bad-soft"
          >
            Empty trash
          </button>
        )}
      </header>

      <div className="-mx-2 flex-1 overflow-auto">
        {trash.length === 0 ? (
          <div className="px-2 py-10 text-center text-[14px] text-ink-faint">
            Trash is empty.
          </div>
        ) : (
          trash.map((e) => (
            <div
              key={e.task.id}
              className="flex items-center gap-3 rounded px-3 py-2 hover:bg-surface-2/60"
            >
              <span className="flex-1 truncate text-[14px] text-ink-soft line-through">
                {e.task.text === "" ? "Untitled" : e.task.text}
              </span>
              {e.task.children.length > 0 && (
                <span className="mono text-[11px] text-ink-faint">
                  +{e.task.children.length}
                </span>
              )}
              <button
                onClick={() => onRestore(e.task.id)}
                className="rounded-sm border border-line px-2 py-1 text-[12px] text-ink-soft hover:bg-surface-2"
              >
                Restore
              </button>
              <button
                onClick={() => onPurge(e.task.id)}
                className="rounded-sm border border-bad/40 px-2 py-1 text-[12px] text-bad hover:bg-bad-soft"
              >
                Delete
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
