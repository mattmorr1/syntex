import { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, TextField,
} from '@mui/material';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message?: string;
  /** Present an input; onConfirm receives its value. Omit for a plain confirmation. */
  inputLabel?: string;
  defaultValue?: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

/**
 * Replaces window.confirm/prompt. Beyond being unstyled, native modals block the whole
 * browser thread, which breaks automated testing of any flow that hits one.
 */
export function ConfirmDialog({
  open, title, message, inputLabel, defaultValue = '',
  confirmLabel = 'Confirm', destructive, onConfirm, onCancel,
}: ConfirmDialogProps) {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => { if (open) setValue(defaultValue); }, [open, defaultValue]);

  const disabled = inputLabel !== undefined && !value.trim();
  const submit = () => { if (!disabled) onConfirm(value.trim()); };

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 14, fontWeight: 600 }}>{title}</DialogTitle>
      <DialogContent sx={{ pb: 1 }}>
        {message && (
          <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: inputLabel ? 2 : 0 }}>
            {message}
          </Typography>
        )}
        {inputLabel !== undefined && (
          <TextField
            autoFocus
            fullWidth
            size="small"
            sx={{ mt: 0.5 }}
            label={inputLabel}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
            InputProps={{ sx: { fontSize: 13 } }}
            InputLabelProps={{ sx: { fontSize: 13 } }}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} size="small" sx={{ fontSize: 12 }}>Cancel</Button>
        <Button
          onClick={submit}
          disabled={disabled}
          size="small"
          variant="contained"
          color={destructive ? 'error' : 'primary'}
          sx={{ fontSize: 12 }}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
