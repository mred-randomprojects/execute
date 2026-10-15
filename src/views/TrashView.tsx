import type { TaskId, TrashedTask } from "../types";
import { sinceLabel } from "../store/dates";

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
    <div className="mx-auto flex h-full w-full page-width flex-col px-10 py-8">
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
              className="group flex items-center gap-3 rounded px-3 py-1.5 hover:bg-surface-2/60"
            >
              {e.task.text === "" ? (
                <span className="flex-1 truncate text-[14px] italic text-ink-faint">Untitled</span>
              ) : (
                <span className="flex-1 truncate text-[14px] text-ink-soft line-through">
                  {e.task.text}
                </span>
              )}
              {e.task.children.length > 0 && (
                <span className="mono text-[11px] text-ink-faint">
                  +{e.task.children.length}
                </span>
              )}
              <span
                className="mono w-[68px] shrink-0 text-right text-[11px] text-ink-faint"
                title={new Date(e.deletedAt).toLocaleString()}
              >
                {sinceLabel(e.deletedAt)}
              </span>
              {/* A pair of buttons on all 187 rows made the page a wall of
                  "Delete". They show on the row you're pointing at. */}
              <span className="flex shrink-0 items-center gap-2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
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
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
