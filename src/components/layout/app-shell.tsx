/**
 * AppShell — ossature applicative (charte §4.1).
 * Sidebar noire repliable + topbar 56px + zone de travail (fond gray-50, padding 24px).
 * Utilisé par la route layout `_app`.
 */
import { useState, type ReactNode } from 'react';
import { AppSidebar } from './app-sidebar';
import { Topbar } from './topbar';

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <AppSidebar collapsed={collapsed} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onToggleSidebar={() => setCollapsed((c) => !c)} />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
