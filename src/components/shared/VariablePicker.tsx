import { useMemo, useState } from 'react';
import { Braces } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import type { SystemVariable } from '@/lib/systemVariables';
import { cn } from '@/lib/utils';

interface Props {
  variables: SystemVariable[];
  onPick: (token: string) => void;
  className?: string;
  size?: 'sm' | 'xs';
}

export default function VariablePicker({ variables, onPick, className, size = 'sm' }: Props) {
  const [open, setOpen] = useState(false);

  const grouped = useMemo(() => {
    const map = new Map<string, SystemVariable[]>();
    for (const v of variables) {
      const arr = map.get(v.group) || [];
      arr.push(v);
      map.set(v.group, arr);
    }
    return [...map.entries()];
  }, [variables]);

  if (variables.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Inserir variável"
          title="Inserir variável"
          onMouseDown={(e) => e.preventDefault()}
          className={cn(size === 'xs' ? 'h-6 w-6' : 'h-7 w-7', 'text-muted-foreground hover:text-foreground', className)}
        >
          <Braces className={size === 'xs' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
        <Command>
          <CommandInput placeholder="Buscar campo" className="h-9 border-0 focus:ring-0" />
          <CommandList className="max-h-72">
            <CommandEmpty>Nenhuma variável.</CommandEmpty>
            {grouped.map(([group, items]) => (
              <CommandGroup
                key={group}
                heading={group.toUpperCase()}
                className="[&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-2"
              >
                {items.map((v) => (
                  <CommandItem
                    key={`${group}:${v.token}`}
                    value={`${v.label} ${v.token}`}
                    onSelect={() => { onPick(`{{${v.token}}}`); setOpen(false); }}
                    title={v.description || `{{${v.token}}}`}
                    className="px-3 py-1.5 text-sm font-medium cursor-pointer"
                  >
                    {v.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
