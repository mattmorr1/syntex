import { useState, useRef, useCallback, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { Box, IconButton, Typography, CircularProgress } from '@mui/material';
import { NavigateBefore, NavigateNext } from '@mui/icons-material';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

interface PdfViewerProps {
  url: string;
  zoom: number;
}

export function PdfViewer({ url, zoom }: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(600);

  useEffect(() => {
    setPage(1);
    setLoading(true);
    setError(false);
  }, [url]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setContainerWidth(w);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const onDocumentLoad = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setLoading(false);
  }, []);

  const onDocumentError = useCallback(() => {
    setLoading(false);
    setError(true);
  }, []);

  const pageWidth = Math.max(100, (containerWidth - 32) * (zoom / 100));

  return (
    <Box ref={containerRef} sx={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Page nav bar */}
      {numPages > 1 && (
        <Box sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1,
          py: 0.5,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          flexShrink: 0,
        }}>
          <IconButton size="small" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} sx={{ p: 0.5 }}>
            <NavigateBefore sx={{ fontSize: 16 }} />
          </IconButton>
          <Typography sx={{ fontSize: 11, fontFamily: 'monospace' }}>
            {page} / {numPages}
          </Typography>
          <IconButton size="small" onClick={() => setPage((p) => Math.min(numPages, p + 1))} disabled={page >= numPages} sx={{ p: 0.5 }}>
            <NavigateNext sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>
      )}

      <Box sx={{ flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center', pt: 1 }}>
        {loading && (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
            <CircularProgress size={20} />
          </Box>
        )}

        {error && !loading && (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
            <Typography variant="caption" color="error">Failed to load PDF</Typography>
          </Box>
        )}

        {!error && (
          <Document
            file={url}
            onLoadSuccess={onDocumentLoad}
            onLoadError={onDocumentError}
            loading={null}
          >
            <Page
              pageNumber={page}
              width={pageWidth}
              renderTextLayer={false}
              renderAnnotationLayer={false}
            />
          </Document>
        )}
      </Box>
    </Box>
  );
}
