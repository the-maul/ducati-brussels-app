import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Ducati Bruxelles" },
      { name: "description", content: "Ducati Bruxelles — application officielle." },
      { property: "og:title", content: "Ducati Bruxelles" },
      { property: "og:description", content: "Ducati Bruxelles — application officielle." },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background">
      <h1 className="text-2xl font-semibold text-foreground">Ducati Bruxelles</h1>
    </main>
  );
}
