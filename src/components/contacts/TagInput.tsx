import { useState, useEffect, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { TagDef } from '@/components/settings/TagsSettings';

interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
}

export default function TagInput({ value, onChange }: TagInputProps) {
  const { tenant } = useAuth();
  const [input, setInput] = useState('');
  const [registeredTags, setRegisteredTags] = useState<TagDef[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tenant) return;
    supabase.from('tenants').select('settings').eq('id', tenant.id).single().then(({ data }) => {
      if (data?.settings && typeof data.settings === 'object' && !Array.isArray(data.settings)) {
        setRegisteredTags((data.settings as Record<string, any>).tags || []);
      }
    });
  }, [tenant]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const getColor = (name: string) => registeredTags.find(t => t.name.toLowerCase() === name.toLowerCase())?.color;

  const filtered = registeredTags.filter(t =>
    !value.includes(t.name) &&
    t.name.toLowerCase().includes(input.toLowerCase())
  );

  const addTag = (name: string) => {
    if (!value.includes(name)) {
      onChange([...value, name]);
    }
    setInput('');
    setShowSuggestions(false);
  };

  const removeTag = (name: string) => {
    onChange(value.filter(t => t !== name));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && input.trim()) {
      e.preventDefault();
      addTag(input.trim());
    }
    if (e.key === 'Backspace' && !input && value.length > 0) {
      removeTag(value[value.length - 1]);
    }
  };

  return (
    <div ref={wrapperRef} className="relative">
      <div className="flex flex-wrap gap-1.5 p-2 border border-input rounded-md bg-background min-h-[40px] items-center cursor-text"
        onClick={() => wrapperRef.current?.querySelector('input')?.focus()}
      >
        {value.map(tag => {
          const color = getColor(tag);
          return (
            <Badge
              key={tag}
              variant="outline"
              className="rounded-full text-[11px] font-normal gap-1 pr-1"
              style={color ? { borderColor: color, color } : undefined}
            >
              {tag}
              <button onClick={(e) => { e.stopPropagation(); removeTag(tag); }} className="hover:opacity-70">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          );
        })}
        <Input
          value={input}
          onChange={e => { setInput(e.target.value); setShowSuggestions(true); }}
          onFocus={() => setShowSuggestions(true)}
          onKeyDown={handleKeyDown}
          placeholder={value.length === 0 ? 'Digitar tag...' : ''}
          className="border-0 p-0 h-6 text-[13px] focus-visible:ring-0 focus-visible:ring-offset-0 flex-1 min-w-[80px] shadow-none"
        />
      </div>

      {showSuggestions && filtered.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-md max-h-40 overflow-y-auto">
          {filtered.map(t => (
            <button
              key={t.name}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent flex items-center gap-2"
              onClick={() => addTag(t.name)}
            >
              <div className="h-3 w-3 rounded-full" style={{ backgroundColor: t.color }} />
              {t.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
