// Reusable path picker row used by both the Settings dialog (Paths tab)
// and the first-run SetupScreen. Shows a read-only input with the current
// value and a browse button that opens the native OS folder/file picker.

import { FolderOpen } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';

export function PathField({
  label,
  description,
  value,
  onChange,
  mode,
  required,
  filters,
}: {
  label: string;
  description: string;
  value: string;
  onChange: (path: string) => void;
  mode: 'directory' | 'file';
  required?: boolean;
  filters?: { name: string; extensions: string[] }[];
}) {
  const handlePick = async () => {
    const picked = await window.electronAPI.pickPath({
      mode,
      title: `Select ${label}`,
      filters,
    });
    if (picked) onChange(picked);
  };

  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium">
        {label}
        {required && <span className="text-destructive"> *</span>}
        {!required && <span className="text-muted-foreground"> (optional)</span>}
      </Label>
      <div className="flex gap-2">
        <Input
          readOnly
          value={value}
          placeholder={required ? 'Required' : 'Not set'}
          className="flex-1 truncate text-xs"
          title={value || undefined}
        />
        <Button variant="outline" size="sm" onClick={handlePick} className="shrink-0">
          <FolderOpen className="h-3.5 w-3.5" />
        </Button>
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">{description}</p>
    </div>
  );
}
