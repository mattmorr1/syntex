import { useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { Box, CircularProgress, Typography } from '@mui/material';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export interface PdfViewerHandle {
  /** Scroll to a point in PDF coordinates and flash it. */
  revealPoint: (page: number, x: number, y: number) => void;
}

interface PdfViewerProps {
  url: string;
  zoom: number;
  /** Click-to-source. Coordinates are PDF points from the page's top-left. */
  onSourceClick?: (page: number, x: number, y: number) => void;
}

export const PdfViewer = forwardRef<PdfViewerHandle, PdfViewerProps>(
function PdfViewer({ url, zoom, onSourceClick }, ref) {
  const [numPages, setNumPages] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(600);
  // Intrinsic page width in PDF points, needed to convert rendered pixels back to points.
  const originalWidthRef = useRef<number | null>(null);
  const pageRefs = useRef<Map<number, HTMLElement>>(new Map());
  const [flash, setFlash] = useState<{ page: number; top: number } | null>(null);

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

  // Rendered pixels -> PDF points. SyncTeX uses a top-left origin in points, which is
  // exactly what dividing the offset within the page box by the render scale produces.
  const handlePageClick = useCallback((pageNumber: number) => (e: React.MouseEvent<HTMLElement>) => {
    if (!onSourceClick) return;
    const original = originalWidthRef.current;
    if (!original) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const scale = rect.width / original;
    if (!scale) return;
    onSourceClick(pageNumber, (e.clientX - rect.left) / scale, (e.clientY - rect.top) / scale);
  }, [onSourceClick]);

  useImperativeHandle(ref, () => ({
    revealPoint: (page, _x, y) => {
      const el = pageRefs.current.get(page);
      const original = originalWidthRef.current;
      const container = containerRef.current;
      if (!el || !original || !container) return;
      const scale = el.getBoundingClientRect().width / original;
      const top = el.offsetTop + y * scale;
      // Park the target a third down the viewport rather than at the very top.
      container.scrollTo({ top: Math.max(0, top - container.clientHeight / 3), behavior: 'smooth' });
      setFlash({ page, top: y * scale });
      setTimeout(() => setFlash(null), 1200);
    },
  }));

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
            <Box
              key={i + 1}
              ref={(el: HTMLElement | null) => {
                if (el) pageRefs.current.set(i + 1, el); else pageRefs.current.delete(i + 1);
              }}
              onClick={handlePageClick(i + 1)}
              sx={{
                mb: 1.5,
                mt: i === 0 ? 1 : 0,
                lineHeight: 0,
                position: 'relative',
                cursor: onSourceClick ? 'pointer' : 'default',
              }}
            >
              {flash?.page === i + 1 && (
                <Box sx={{
                  position: 'absolute', left: 0, right: 0, top: flash.top - 2, height: 16,
                  bgcolor: 'rgba(124, 58, 237, 0.28)', pointerEvents: 'none',
                  animation: 'synctexFlash 1.2s ease-out forwards',
                  '@keyframes synctexFlash': { from: { opacity: 1 }, to: { opacity: 0 } },
                }} />
              )}
              <Page
                pageNumber={i + 1}
                width={pageWidth}
                onLoadSuccess={(page: any) => { originalWidthRef.current = page.originalWidth; }}
                renderTextLayer={false}
                renderAnnotationLayer={false}
              />
            </Box>
          ))}
        </Document>
      )}
    </Box>
  );
});
