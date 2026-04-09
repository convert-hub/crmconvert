import { useState, useEffect } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2 } from "lucide-react";

export interface LinkedEntity {
  type: string;
  label: string;
  count: number;
  icon: React.ReactNode;
  checked: boolean;
}

interface CascadeDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  linkedEntities: LinkedEntity[];
  onConfirm: (entitiesToDelete: string[]) => Promise<void>;
  isLoading?: boolean;
}

export function CascadeDeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  linkedEntities,
  onConfirm,
  isLoading = false,
}: CascadeDeleteDialogProps) {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (open) {
      const initial: Record<string, boolean> = {};
      linkedEntities.forEach((e) => {
        initial[e.type] = e.checked;
      });
      setSelected(initial);
    }
  }, [open, linkedEntities]);

  // Auto-select all when "contact" is checked
  useEffect(() => {
    if (selected["contact"]) {
      setSelected((prev) => {
        const next = { ...prev };
        linkedEntities.forEach((e) => {
          if (e.count > 0) next[e.type] = true;
        });
        return next;
      });
    }
  }, [selected["contact"]]);

  const handleConfirm = async () => {
    setDeleting(true);
    const toDelete = Object.entries(selected)
      .filter(([_, v]) => v)
      .map(([k]) => k);
    await onConfirm(toDelete);
    setDeleting(false);
  };

  const hasLinked = linkedEntities.some((e) => e.count > 0);
  const busy = deleting || isLoading;

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        {hasLinked && (
          <div className="space-y-3 py-2">
            <p className="text-sm font-medium text-foreground">
              Entidades vinculadas encontradas:
            </p>
            <div className="space-y-2">
              {linkedEntities
                .filter((e) => e.count > 0)
                .map((entity) => (
                  <label
                    key={entity.type}
                    className="flex items-center gap-2 cursor-pointer rounded-lg border border-border px-3 py-2 hover:bg-muted/50 transition-colors"
                  >
                    <Checkbox
                      checked={!!selected[entity.type]}
                      onCheckedChange={(checked) =>
                        setSelected((prev) => ({ ...prev, [entity.type]: !!checked }))
                      }
                      disabled={busy}
                    />
                    {entity.icon}
                    <span className="text-sm">
                      {entity.label} ({entity.count})
                    </span>
                  </label>
                ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Marque os itens que deseja excluir junto. Itens desmarcados serão desvinculados mas não excluídos.
            </p>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={busy}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Excluir
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
