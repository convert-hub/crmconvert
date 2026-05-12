import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import VariablePicker from './VariablePicker';
import type { SystemVariable } from '@/lib/systemVariables';
import { cn } from '@/lib/utils';

type SharedProps = {
  variables: SystemVariable[];
  value: string;
  onChange: (value: string) => void;
  containerClassName?: string;
};

function insertAtCursor(
  el: HTMLInputElement | HTMLTextAreaElement | null,
  current: string,
  token: string,
): { next: string; cursor: number } {
  if (!el) return { next: current + token, cursor: (current + token).length };
  const start = el.selectionStart ?? current.length;
  const end = el.selectionEnd ?? current.length;
  const next = current.slice(0, start) + token + current.slice(end);
  return { next, cursor: start + token.length };
}

export const VariableInput = React.forwardRef<
  HTMLInputElement,
  SharedProps & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>
>(({ variables, value, onChange, containerClassName, className, ...props }, ref) => {
  const innerRef = React.useRef<HTMLInputElement | null>(null);
  React.useImperativeHandle(ref, () => innerRef.current as HTMLInputElement);

  const handlePick = (token: string) => {
    const { next, cursor } = insertAtCursor(innerRef.current, value ?? '', token);
    onChange(next);
    requestAnimationFrame(() => {
      innerRef.current?.focus();
      innerRef.current?.setSelectionRange(cursor, cursor);
    });
  };

  return (
    <div className={cn('relative', containerClassName)}>
      <Input
        ref={innerRef}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className={cn('pr-9', className)}
        {...props}
      />
      <div className="absolute right-1 top-1/2 -translate-y-1/2">
        <VariablePicker variables={variables} onPick={handlePick} size="xs" />
      </div>
    </div>
  );
});
VariableInput.displayName = 'VariableInput';

export const VariableTextarea = React.forwardRef<
  HTMLTextAreaElement,
  SharedProps & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'>
>(({ variables, value, onChange, containerClassName, className, ...props }, ref) => {
  const innerRef = React.useRef<HTMLTextAreaElement | null>(null);
  React.useImperativeHandle(ref, () => innerRef.current as HTMLTextAreaElement);

  const handlePick = (token: string) => {
    const { next, cursor } = insertAtCursor(innerRef.current, value ?? '', token);
    onChange(next);
    requestAnimationFrame(() => {
      innerRef.current?.focus();
      innerRef.current?.setSelectionRange(cursor, cursor);
    });
  };

  return (
    <div className={cn('relative', containerClassName)}>
      <Textarea
        ref={innerRef}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className={cn('pr-9', className)}
        {...props}
      />
      <div className="absolute right-1 top-1">
        <VariablePicker variables={variables} onPick={handlePick} size="xs" />
      </div>
    </div>
  );
});
VariableTextarea.displayName = 'VariableTextarea';
