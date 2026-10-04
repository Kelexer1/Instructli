'use client';

import { useId, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

export interface WindowTab {
  id: string;
  label: string;
  content: ReactNode;
}

interface WindowTabsProps {
  tabs: WindowTab[];
  defaultTabId?: string;
  activeTabId?: string;
  onTabChange?: (tabId: string) => void;
  className?: string;
  panelClassName?: string;
  ariaLabel?: string;
}

export function WindowTabs({
  tabs,
  defaultTabId,
  activeTabId,
  onTabChange,
  className = '',
  panelClassName = '',
  ariaLabel = 'Window tabs',
}: WindowTabsProps) {
  const tabGroupId = useId();
  const [uncontrolledTabId, setUncontrolledTabId] = useState(
    defaultTabId ?? tabs[0]?.id,
  );
  const selectedTabId = activeTabId ?? uncontrolledTabId;
  const selectedTab = tabs.find((tab) => tab.id === selectedTabId) ?? tabs[0];

  if (!selectedTab) {
    return null;
  }

  const selectTab = (tabId: string) => {
    if (activeTabId === undefined) {
      setUncontrolledTabId(tabId);
    }
    onTabChange?.(tabId);
  };

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    tabIndex: number,
  ) => {
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (direction === 0) return;

    event.preventDefault();
    const nextTab = tabs[(tabIndex + direction + tabs.length) % tabs.length];
    selectTab(nextTab.id);
    document.getElementById(`${tabGroupId}-tab-${nextTab.id}`)?.focus();
  };

  return (
    <div className={`flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      <div
        className="flex shrink-0 items-end gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 px-2 pt-2"
        role="tablist"
        aria-label={ariaLabel}
      >
        {tabs.map((tab, index) => {
          const isSelected = tab.id === selectedTab.id;
          return (
            <button
              key={tab.id}
              id={`${tabGroupId}-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-controls={`${tabGroupId}-panel-${tab.id}`}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => selectTab(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
              className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 ${
                isSelected
                  ? 'border-indigo-500 bg-white text-gray-900'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div
        id={`${tabGroupId}-panel-${selectedTab.id}`}
        role="tabpanel"
        aria-labelledby={`${tabGroupId}-tab-${selectedTab.id}`}
        tabIndex={0}
        className={`min-h-0 flex-1 overflow-auto p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${panelClassName}`}
      >
        {selectedTab.content}
      </div>
    </div>
  );
}
