import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { WorkspaceTab } from "../types";

type TreeKind = "root" | "folder" | "file";

interface TreeSpec {
  id: string;
  kind: TreeKind;
  name: string;
  /** Program editor tab id when kind === file */
  programTabId?: string;
  children?: TreeSpec[];
}

const TREE: TreeSpec = {
  id: "root",
  kind: "root",
  name: "promptful-sync",
  children: [
    {
      id: "java",
      kind: "folder",
      name: "src/main/java/com/acme/calendar",
      children: [
        { id: "f-cal", kind: "file", name: "Calendar.java", programTabId: "cal-java" },
        { id: "f-svc", kind: "file", name: "CalendarService.java", programTabId: "svc-java" },
      ],
    },
    {
      id: "kotlin",
      kind: "folder",
      name: "src/main/kotlin/com/acme/client",
      children: [{ id: "f-api", kind: "file", name: "ApiClient.kt", programTabId: "api-kt" }],
    },
    {
      id: "py",
      kind: "folder",
      name: "python/security",
      children: [{ id: "f-sec", kind: "file", name: "Security.py", programTabId: "sec-py" }],
    },
    {
      id: "res",
      kind: "folder",
      name: "src/main/resources",
      children: [{ id: "f-yaml", kind: "file", name: "application.yml", programTabId: "yaml" }],
    },
  ],
};

/** Folder/root ids along the branch to `programTabId` (excluding the file), for auto-expand. */
export function explorerAncestorIdsForProgramTab(programTabId: string): readonly string[] {
  function dfs(node: TreeSpec, prefix: readonly string[]): readonly string[] | null {
    if (node.kind === "file" && node.programTabId === programTabId) return [...prefix];
    const nextPrefix =
      node.kind === "folder" || node.kind === "root" ? [...prefix, node.id] : prefix;
    for (const ch of node.children ?? []) {
      const r = dfs(ch, nextPrefix);
      if (r) return r;
    }
    return null;
  }
  return dfs(TREE, []) ?? [];
}

function RowFolder({
  name,
  open,
  onToggle,
  depth,
  children,
}: {
  name: string;
  open: boolean;
  onToggle: () => void;
  depth: number;
  children: ReactNode;
}) {
  return (
    <>
      <button
        type="button"
        className="pf-explorer__row pf-explorer__row--folder"
        style={{ paddingLeft: 10 + depth * 12 }}
        onClick={onToggle}
      >
        <span className="pf-explorer__chev" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
        <span className="pf-explorer__name">{name}</span>
      </button>
      {open && children}
    </>
  );
}

function RowFile({
  name,
  depth,
  active,
  onOpen,
}: {
  name: string;
  depth: number;
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={`pf-explorer__row pf-explorer__row--file ${active ? "pf-explorer__row--active" : ""}`}
      style={{ paddingLeft: 26 + depth * 12 }}
      onClick={onOpen}
    >
      <span className="pf-explorer__name">{name}</span>
    </button>
  );
}

function TreeBranch({
  node,
  depth,
  expanded,
  toggle,
  activeProgramTabId,
  workspaceTab,
  onOpenFile,
  onSelectPlanFile,
  planSelectedTabId,
}: {
  node: TreeSpec;
  depth: number;
  expanded: Set<string>;
  toggle: (id: string) => void;
  activeProgramTabId: string | null;
  workspaceTab: WorkspaceTab;
  onOpenFile: (programTabId: string) => void;
  onSelectPlanFile?: (programTabId: string) => void;
  planSelectedTabId: string;
}) {
  if (node.kind === "folder" || node.kind === "root") {
    const open = expanded.has(node.id);
    const list = node.children ?? [];
    return (
      <RowFolder key={node.id} name={node.name} open={open} onToggle={() => toggle(node.id)} depth={depth}>
        {list.map((ch) => (
          <TreeBranch
            key={ch.id}
            node={ch}
            depth={depth + 1}
            expanded={expanded}
            toggle={toggle}
            activeProgramTabId={activeProgramTabId}
            workspaceTab={workspaceTab}
            onOpenFile={onOpenFile}
            onSelectPlanFile={onSelectPlanFile}
            planSelectedTabId={planSelectedTabId}
          />
        ))}
      </RowFolder>
    );
  }

  const activeProgram =
    workspaceTab === "program" && node.programTabId != null && activeProgramTabId === node.programTabId;
  const activePlan =
    workspaceTab === "plan" && node.programTabId != null && planSelectedTabId === node.programTabId;
  const active = activeProgram || activePlan;
  return (
    <RowFile
      key={node.id}
      name={node.name}
      depth={depth}
      active={Boolean(active)}
      onOpen={() => {
        if (!node.programTabId) return;
        if (workspaceTab === "plan") onSelectPlanFile?.(node.programTabId);
        else onOpenFile(node.programTabId);
      }}
    />
  );
}

export function ExplorerSidebar({
  collapsed,
  onToggleCollapsed,
  workspaceTab,
  activeProgramTabId,
  planSelectedTabId,
  onOpenProgramFile,
  onSelectPlanFile,
  workspaceFiles,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  workspaceTab: WorkspaceTab;
  activeProgramTabId: string;
  planSelectedTabId: string;
  onOpenProgramFile: (tabId: string) => void;
  onSelectPlanFile: (tabId: string) => void;
  workspaceFiles?: Array<{ id: string; label: string }>;
}) {
  const [expanded, setExpanded] = useState(() => new Set(["root", "java", "kotlin", "py", "res"]));

  const explorerTargetTabId = workspaceTab === "program" ? activeProgramTabId : planSelectedTabId;

  useEffect(() => {
    if (workspaceTab !== "program" && workspaceTab !== "plan") return;
    const anc = explorerAncestorIdsForProgramTab(explorerTargetTabId);
    if (anc.length === 0) return;
    setExpanded((prev) => {
      const n = new Set(prev);
      for (const id of anc) n.add(id);
      return n;
    });
  }, [workspaceTab, explorerTargetTabId]);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const explorerLabel = useMemo(() => "Files", []);

  return (
    <aside
      className={`pf-explorer ${collapsed ? "pf-explorer--collapsed" : ""}`}
      aria-label={explorerLabel}
      aria-expanded={!collapsed}
    >
      {collapsed ? (
        <button
          type="button"
          className="pf-explorer__rail-hit"
          onClick={onToggleCollapsed}
          title="Expand file explorer"
          aria-expanded={false}
        >
          <span className="pf-explorer__rail-icon" aria-hidden>
            ▸
          </span>
          <span className="pf-explorer__rail-label">Files</span>
        </button>
      ) : (
        <>
          <div className="pf-explorer__head">
            <span className="pf-explorer__title">{explorerLabel}</span>
            <button
              type="button"
              className="pf-explorer__icon-btn"
              onClick={onToggleCollapsed}
              title="Collapse file explorer"
              aria-expanded
            >
              <span aria-hidden className="pf-explorer__sink">
                ◀
              </span>
            </button>
          </div>
          <div className="pf-explorer__tree" role="tree">
            {workspaceFiles && workspaceFiles.length > 0 ? (
              workspaceFiles.map((f) => {
                const activeProgram = workspaceTab === "program" && activeProgramTabId === f.id;
                const activePlan = workspaceTab === "plan" && planSelectedTabId === f.id;
                return (
                  <RowFile
                    key={f.id}
                    name={f.label}
                    depth={0}
                    active={activeProgram || activePlan}
                    onOpen={() => {
                      if (workspaceTab === "plan") onSelectPlanFile(f.id);
                      else onOpenProgramFile(f.id);
                    }}
                  />
                );
              })
            ) : (
              <TreeBranch
                node={TREE}
                depth={0}
                expanded={expanded}
                toggle={toggle}
                activeProgramTabId={activeProgramTabId}
                workspaceTab={workspaceTab}
                onOpenFile={onOpenProgramFile}
                onSelectPlanFile={onSelectPlanFile}
                planSelectedTabId={planSelectedTabId}
              />
            )}
          </div>
        </>
      )}
    </aside>
  );
}
