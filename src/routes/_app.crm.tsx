import { createFileRoute, Outlet } from '@tanstack/react-router';

// Clients (CRM) : le pipeline (index) et les Relances (M10, 31/10/2026). Memes droits.
export const Route = createFileRoute('/_app/crm')({ component: () => <Outlet /> });
