import { Button } from "@getficksd/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@getficksd/ui/components/dialog";
import { useNavigate } from "@tanstack/react-router";
import { CornerDownLeftIcon, SearchIcon } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import { appNavigation, type AppPath } from "@/lib/navigation";

export function CommandPalette() {
  const routerNavigate = useNavigate();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [modifierLabel, setModifierLabel] = useState("⌘");

  useEffect(() => {
    const isApple = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
    setModifierLabel(isApple ? "⌘" : "Ctrl");

    function handleKeyDown(event: KeyboardEvent) {
      if (event.code === "KeyK" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((current) => !current);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const sections = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return appNavigation;
    }

    return appNavigation
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => item.title.toLowerCase().includes(normalizedQuery)),
      }))
      .filter((section) => section.items.length > 0);
  }, [query]);

  const items = useMemo(() => sections.flatMap((section) => section.items), [sections]);
  const activeItem = items[activeIndex];

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  useEffect(() => {
    if (!activeItem) {
      return;
    }

    document
      .getElementById(`${listId}-${activeItem.url.slice(1)}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeItem, listId]);

  function navigate(url: AppPath) {
    setOpen(false);
    setQuery("");
    void routerNavigate({ to: url });
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!items.length) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % items.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + items.length) % items.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(items.length - 1);
    } else if (event.key === "Enter" && activeItem) {
      event.preventDefault();
      navigate(activeItem.url);
    }
  }

  let itemIndex = -1;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          setQuery("");
        }
      }}
    >
      <DialogTrigger
        render={
          <Button
            className="ml-auto hidden w-52 justify-start overflow-hidden rounded-lg text-muted-foreground shadow-none sm:flex"
            variant="outline"
            aria-label="Open command palette"
          />
        }
      >
        <SearchIcon />
        <span className="min-w-0 flex-1 truncate text-left">Search or jump to...</span>
        <kbd className="ml-auto shrink-0 rounded border bg-muted px-1.5 py-0.5 text-[10px] leading-none">
          {modifierLabel} K
        </kbd>
      </DialogTrigger>

      <DialogContent
        className="top-[45%] flex h-[30rem] max-h-[calc(100dvh-2rem)] max-w-[calc(100%-2rem)] flex-col overflow-visible rounded-2xl border border-white/10 bg-popover/95 p-0 shadow-2xl ring-0 backdrop-blur-xl sm:max-w-xl"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search for a page. Use the arrow keys to select a result and Enter to open it.
        </DialogDescription>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
          <div className="border-b border-border/70 px-4 pt-4 pb-3">
            <span className="inline-flex rounded-md border border-border/60 bg-muted/80 px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-sm">
              Actions
            </span>
            <div className="mt-4 flex items-center gap-3">
              <SearchIcon className="size-5 shrink-0 text-muted-foreground" />
              <input
                aria-activedescendant={
                  activeItem ? `${listId}-${activeItem.url.slice(1)}` : undefined
                }
                aria-autocomplete="list"
                aria-controls={listId}
                aria-expanded="true"
                aria-label="Search commands"
                autoComplete="off"
                autoFocus
                className="h-9 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground/75"
                dir="auto"
                placeholder="Type a command or search..."
                role="combobox"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleInputKeyDown}
              />
              <kbd className="rounded-md border border-border/70 bg-muted/60 px-2 py-1 text-[10px] text-muted-foreground shadow-sm">
                Esc
              </kbd>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2" id={listId} role="listbox">
            {sections.length ? (
              sections.map((section) => (
                <div
                  aria-labelledby={`${listId}-${section.label.toLowerCase()}`}
                  className="mb-1 last:mb-0"
                  key={section.label}
                  role="group"
                >
                  <p
                    className="px-2.5 pt-2 pb-1.5 text-xs font-medium text-muted-foreground"
                    id={`${listId}-${section.label.toLowerCase()}`}
                  >
                    {section.label}
                  </p>
                  {section.items.map((item) => {
                    itemIndex += 1;
                    const currentIndex = itemIndex;
                    const isActive = currentIndex === activeIndex;

                    return (
                      <button
                        aria-selected={isActive}
                        className="group relative flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left text-sm outline-none transition-colors before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-primary before:opacity-0 hover:bg-muted/70 focus-visible:bg-muted/70 aria-selected:bg-muted/70 aria-selected:before:opacity-100"
                        id={`${listId}-${item.url.slice(1)}`}
                        key={item.url}
                        role="option"
                        type="button"
                        onClick={() => navigate(item.url)}
                        onMouseMove={() => setActiveIndex(currentIndex)}
                      >
                        <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border/60 bg-background/60 text-muted-foreground shadow-sm transition-colors group-hover:text-foreground group-aria-selected:text-foreground">
                          <item.icon className="size-4" />
                        </span>
                        <span className="flex-1 font-medium">{item.title}</span>
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-aria-selected:opacity-100">
                          Open
                          <kbd className="grid size-5 place-items-center rounded border border-border/70 bg-background/70 shadow-sm">
                            <CornerDownLeftIcon className="size-3" />
                          </kbd>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))
            ) : (
              <div className="grid place-items-center px-4 py-12 text-center" role="status">
                <SearchIcon className="mb-3 size-5 text-muted-foreground" />
                <p className="text-sm font-medium">No matching pages</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Try another command or search term.
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-border/70 bg-muted/25 px-4 py-2.5 text-[11px] text-muted-foreground">
            <span>
              {items.length} {items.length === 1 ? "result" : "results"}
            </span>
            <span className="hidden items-center gap-2 sm:flex">
              <span>↑↓ Navigate</span>
              <span>↵ Open</span>
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
