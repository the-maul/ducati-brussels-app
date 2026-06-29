/**
 * AppShell — ossature applicative (charte §4.1).
 * Sidebar noire repliable + topbar 56px + zone de travail (fond gray-50, padding 24px).
 * Utilisé par la route layout `_app`.
 */
import { useState, type ReactNode } from 'react';
import { AppSidebar } from './app-sidebar';
import { Topbar } from './topbar';
import { MobileBottomNav } from './mobile-bottom-nav';
import { MyDucatiListener } from '@/components/myducati-listener';
import { useIsMobile } from '@/hooks/use-mobile';

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const isMobile = useIsMobile();

  // Bouton menu : ouvre le tiroir sur smartphone, replie la sidebar sur desktop.
  const onMenu = () => (isMobile ? setMobileOpen((o) => !o) : setCollapsed((c) => !c));

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <AppSidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onNavigate={() => setMobileOpen(false)}
      />

      {/* Voile sombre derrière le tiroir (smartphone) */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="Fermer le menu"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={onMenu} />
        {/* pb-20 : laisse la place à la barre basse sur smartphone */}
        <main className="flex-1 overflow-auto p-4 pb-20 md:p-6 md:pb-6">{children}</main>
      </div>

      <MobileBottomNav onMore={() => setMobileOpen(true)} />
      <MyDucatiListener />
    </div>
  );
}
