/**
 * Éditeur de texte enrichi minimal (gras, italique, souligné, listes, lien) — produit
 * du HTML. Sans dépendance externe (contentEditable + commandes navigateur), déployable.
 * Non contrôlé : on initialise le HTML au montage et on remonte les changements via onChange.
 */
import { useRef, useEffect } from 'react';
import { Bold, Italic, Underline, List, ListOrdered, Link2, Eraser } from 'lucide-react';

type Cmd = { icon: typeof Bold; cmd: string; arg?: string; title: string };
const CMDS: Cmd[] = [
  { icon: Bold, cmd: 'bold', title: 'Gras' },
  { icon: Italic, cmd: 'italic', title: 'Italique' },
  { icon: Underline, cmd: 'underline', title: 'Souligné' },
  { icon: List, cmd: 'insertUnorderedList', title: 'Liste à puces' },
  { icon: ListOrdered, cmd: 'insertOrderedList', title: 'Liste numérotée' },
];

export function RichEditor({ html, onChange, resetKey, placeholder }: { html: string; onChange: (h: string) => void; resetKey?: unknown; placeholder?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // Initialise / réinitialise le contenu (au montage et quand resetKey change).
  useEffect(() => { if (ref.current) ref.current.innerHTML = html || ''; /* eslint-disable-next-line */ }, [resetKey]);

  const exec = (cmd: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    if (ref.current) onChange(ref.current.innerHTML);
  };
  const link = () => { const u = prompt('Adresse du lien (https://…)'); if (u) exec('createLink', u); };

  return (
    <div className="rounded-md border border-border">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted px-1 py-1">
        {CMDS.map((c) => (
          <button key={c.cmd} type="button" title={c.title} onMouseDown={(e) => { e.preventDefault(); exec(c.cmd, c.arg); }}
            className="grid size-7 place-items-center rounded hover:bg-accent"><c.icon className="size-3.5" /></button>
        ))}
        <button type="button" title="Lien" onMouseDown={(e) => { e.preventDefault(); link(); }} className="grid size-7 place-items-center rounded hover:bg-accent"><Link2 className="size-3.5" /></button>
        <button type="button" title="Effacer la mise en forme" onMouseDown={(e) => { e.preventDefault(); exec('removeFormat'); }} className="grid size-7 place-items-center rounded hover:bg-accent"><Eraser className="size-3.5" /></button>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder ?? ''}
        onInput={(e) => onChange((e.currentTarget as HTMLDivElement).innerHTML)}
        className="min-h-[120px] px-3 py-2 text-sm outline-none [&:empty:before]:text-muted-foreground [&:empty:before]:content-[attr(data-placeholder)]"
      />
    </div>
  );
}
