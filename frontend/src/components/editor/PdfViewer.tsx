import { useState } from 'react';
import { Box, Typography, CircularProgress } from '@mui/material';

interface PdfViewerProps {
  url: string;
  zoom: number;
}

export function PdfViewer({ url, zoom }: PdfViewerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Handle data URL (base64 PDF)
  const isDataUrl = url.startsWith('data:');
  
  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      {loading && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={24} />
        </Box>
      )}
      
      {error ? (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <Typography color="error">Failed to load PDF</Typography>
        </Box>
      ) : (
        <Box
          sx={{
            width: '100%',
            height: '100%',
            transform: `scale(${zoom / 100})`,
            transformOrigin: 'top center',
            transition: 'transform 0.2s',
          }}
        >
          {isDataUrl ? (
            <embed
              src={url}
              type="application/pdf"
              width="100%"
              height="100%"
              style={{ border: 'none' }}
              onLoad={() => setLoading(false)}
              onError={() => {
                setLoading(false);
                setError(true);
              }}
            />
          ) : (
            <iframe
              src={url}
              title="PDF Preview"
              width="100%"
              height="100%"
              style={{ border: 'none' }}
              onLoad={() => setLoading(false)}
              onError={() => {
                setLoading(false);
                setError(true);
              }}
            />
          )}
        </Box>
      )}
    </Box>
  );
}
