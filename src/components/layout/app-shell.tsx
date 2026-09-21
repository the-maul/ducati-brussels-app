/**
 * AppShell — ossature applicative (charte §4.1).
 * Sidebar noire repliable + topbar 56px + zone de travail (fond gray-50, padding 24px).
 * Utilisé par la route layout `_app`.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { AppSidebar } from './app-sidebar';
import { Topbar } from './topbar';
import { MobileBottomNav } from './mobile-bottom-nav';
import { MyDucatiListener } from '@/components/myducati-listener';
import { CatalogImportListener } from '@/components/catalog-import-listener';
import { useIsMobile } from '@/hooks/use-mobile';

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const isMobile = useIsMobile();

  // Bouton menu : ouvre le tiroir sur smartphone, replie la sidebar sur desktop.
  const onMenu = () => (isMobile ? setMobileOpen((o) => !o) : setCollapsed((c) => !c));

  // Seule la zone de travail défile : on bloque le défilement de la page entière,
  // sinon un élément caché hors de l'écran laisse « scroller sous l'app » (fond vide).
  useEffect(() => {
    const els = [document.documentElement, document.body];
    const prev = els.map((el) => el.style.overflow);
    els.forEach((el) => { el.style.overflow = 'hidden'; });
    return () => els.forEach((el, i) => { el.style.overflow = prev[i]; });
  }, []);

  return (
    <div className="fixed inset-0 flex h-dvh w-full overflow-hidden bg-background">
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
      <CatalogImportListener />
    </div>
  );
}
