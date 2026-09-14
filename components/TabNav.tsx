"use client";

import { ClipboardList, ListChecks, LayoutGrid } from "lucide-react";

export type TabKey = "planning" | "checkin" | "dashboard";

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: "planning", label: "Objectifs & Planning", icon: <ClipboardList size={16} /> },
  { key: "checkin", label: "Check-in du soir", icon: <ListChecks size={16} /> },
  { key: "dashboard", label: "Planning & Scoring", icon: <LayoutGrid size={16} /> },
];

export function TabNav({
  active,
  onChange,
}: {
  active: TabKey;
  onChange: (tab: TabKey) => void;
}) {
  return (
    <nav className="border-b border-line">
      <div className="mx-auto flex max-w-3xl gap-1 px-4">
        {TABS.map((tab) => {
          const isActive = tab.key === active;
          return (
            <button
              key={tab.key}
              onClick={() => onChange(tab.key)}
              className={[
                "flex items-center gap-2 border-b-2 px-3 py-3 text-sm transition-colors",
                isActive
                  ? "border-ink font-medium text-ink"
                  : "border-transparent text-muted hover:text-ink",
              ].join(" ")}
            >
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
