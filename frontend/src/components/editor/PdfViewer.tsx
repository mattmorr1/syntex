import { useState, useRef, useCallback, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { Box, CircularProgress, Typography } from '@mui/material';
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(600);

  useEffect(() => {
    setLoading(true);
    setError(false);
    setNumPages(0);
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
    <Box
      ref={containerRef}
      sx={{ width: '100%', height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
    >
      {loading && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', pt: 4 }}>
          <CircularProgress size={20} />
        </Box>
      )}

      {error && !loading && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', pt: 4 }}>
          <Typography variant="caption" color="error">Failed to load PDF</Typography>
        </Box>
      )}

      {!error && (
        <Document
          key={url}
          file={url}
          onLoadSuccess={onDocumentLoad}
          onLoadError={onDocumentError}
          loading={null}
        >
          {Array.from({ length: numPages }, (_, i) => (
            <Box key={i + 1} sx={{ mb: 1.5, mt: i === 0 ? 1 : 0 }}>
              <Page
                pageNumber={i + 1}
                width={pageWidth}
                renderTextLayer={false}
                renderAnnotationLayer={false}
              />
            </Box>
          ))}
        </Document>
      )}
    </Box>
  );
}
