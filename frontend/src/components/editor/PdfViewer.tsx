import { useState } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';

interface PdfViewerProps {
  url: string;
  zoom: number;
}

export function PdfViewer({ url, zoom }: PdfViewerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  return (
    <Box sx={{ width: '100%', height: '100%', position: 'relative' }}>
      {loading && (
        <Box sx={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1,
        }}>
          <CircularProgress size={20} />
        </Box>
      )}

      {error ? (
        <Box sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%'
        }}>
          <Typography variant="caption" color="error">Failed to load PDF</Typography>
        </Box>
      ) : (
        <Box
          sx={{
            width: '100%',
            height: '100%',
            transform: `scale(${zoom / 100})`,
            transformOrigin: 'top center',
          }}
        >
          <iframe
            src={url}
            title="PDF"
            width="100%"
            height="100%"
            style={{ border: 'none', display: 'block' }}
            onLoad={() => setLoading(false)}
            onError={() => { setLoading(false); setError(true); }}
          />
        </Box>
      )}
    </Box>
  );
}
