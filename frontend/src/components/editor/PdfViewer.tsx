import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Box, Typography, TextField, InputAdornment, IconButton, CircularProgress } from '@mui/material';
import { Search, Close, KeyboardArrowUp, KeyboardArrowDown } from '@mui/icons-material';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';

// Configure pdf.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PdfViewerProps {
  url: string;
  zoom: number;
}

export interface PdfViewerHandle {
  openSearch: () => void;
}

export const PdfViewer = forwardRef<PdfViewerHandle, PdfViewerProps>(({ url, zoom }, ref) => {
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState<number[]>([]);
  const [currentMatch, setCurrentMatch] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Expose methods to parent
  useImperativeHandle(ref, () => ({
    openSearch: () => {
      setSearchOpen(true);
      setTimeout(() => searchInputRef.current?.focus(), 100);
    },
  }));

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setLoading(false);
    setError(null);
  };

  const onDocumentLoadError = (err: Error) => {
    setLoading(false);
    setError('Failed to load PDF');
    console.error('PDF load error:', err);
  };

  // Track current page on scroll
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const containerRect = container.getBoundingClientRect();
      const containerCenter = containerRect.top + containerRect.height / 2;

      let closestPage = 1;
      let closestDistance = Infinity;

      pageRefs.current.forEach((ref, pageNum) => {
        const rect = ref.getBoundingClientRect();
        const pageCenter = rect.top + rect.height / 2;
        const distance = Math.abs(pageCenter - containerCenter);

        if (distance < closestDistance) {
          closestDistance = distance;
          closestPage = pageNum;
        }
      });

      setCurrentPage(closestPage);
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [numPages]);

  // Keyboard shortcut for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 100);
      }
      if (e.key === 'Escape') {
        setSearchOpen(false);
        setSearchText('');
        setSearchResults([]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Simple text search in PDF
  const handleSearch = useCallback(async () => {
    if (!searchText.trim() || !numPages) {
      setSearchResults([]);
      return;
    }

    const results: number[] = [];
    const searchLower = searchText.toLowerCase();

    // Search through text layers
    for (let i = 1; i <= numPages; i++) {
      const pageRef = pageRefs.current.get(i);
      if (pageRef) {
        const textLayer = pageRef.querySelector('.react-pdf__Page__textContent');
        if (textLayer && textLayer.textContent?.toLowerCase().includes(searchLower)) {
          results.push(i);
        }
      }
    }

    setSearchResults(results);
    setCurrentMatch(0);

    if (results.length > 0) {
      scrollToPage(results[0]);
    }
  }, [searchText, numPages]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(handleSearch, 300);
    return () => clearTimeout(timer);
  }, [searchText, handleSearch]);

  const scrollToPage = (pageNum: number) => {
    const pageRef = pageRefs.current.get(pageNum);
    if (pageRef && containerRef.current) {
      pageRef.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleNextMatch = () => {
    if (searchResults.length === 0) return;
    const next = (currentMatch + 1) % searchResults.length;
    setCurrentMatch(next);
    scrollToPage(searchResults[next]);
  };

  const handlePrevMatch = () => {
    if (searchResults.length === 0) return;
    const prev = (currentMatch - 1 + searchResults.length) % searchResults.length;
    setCurrentMatch(prev);
    scrollToPage(searchResults[prev]);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (e.shiftKey) {
        handlePrevMatch();
      } else {
        handleNextMatch();
      }
    }
  };

  const scale = zoom / 100;

  return (
    <Box sx={{ width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column' }}>
      {/* Search Bar */}
      {searchOpen && (
        <Box
          sx={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 10,
            bgcolor: 'background.paper',
            borderRadius: 1,
            boxShadow: 2,
            display: 'flex',
            alignItems: 'center',
            p: 0.5,
          }}
        >
          <TextField
            inputRef={searchInputRef}
            size="small"
            placeholder="Search in PDF..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            autoFocus
            sx={{
              width: 200,
              '& .MuiInputBase-root': { fontSize: 12, height: 32 },
              '& .MuiOutlinedInput-notchedOutline': { border: 'none' },
            }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search sx={{ fontSize: 16, color: 'text.disabled' }} />
                </InputAdornment>
              ),
            }}
          />
          {searchResults.length > 0 && (
            <Typography variant="caption" sx={{ mx: 1, fontSize: 11, color: 'text.secondary', whiteSpace: 'nowrap' }}>
              {currentMatch + 1} / {searchResults.length}
            </Typography>
          )}
          {searchText && searchResults.length === 0 && (
            <Typography variant="caption" sx={{ mx: 1, fontSize: 11, color: 'text.disabled', whiteSpace: 'nowrap' }}>
              No results
            </Typography>
          )}
          <IconButton size="small" onClick={handlePrevMatch} disabled={searchResults.length === 0} sx={{ p: 0.25 }}>
            <KeyboardArrowUp sx={{ fontSize: 18 }} />
          </IconButton>
          <IconButton size="small" onClick={handleNextMatch} disabled={searchResults.length === 0} sx={{ p: 0.25 }}>
            <KeyboardArrowDown sx={{ fontSize: 18 }} />
          </IconButton>
          <IconButton
            size="small"
            onClick={() => {
              setSearchOpen(false);
              setSearchText('');
              setSearchResults([]);
            }}
            sx={{ p: 0.25 }}
          >
            <Close sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>
      )}

      {/* Page Indicator */}
      {numPages > 0 && (
        <Box
          sx={{
            position: 'absolute',
            bottom: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 10,
            bgcolor: 'rgba(0,0,0,0.6)',
            color: 'white',
            px: 1.5,
            py: 0.5,
            borderRadius: 1,
            fontSize: 11,
            fontWeight: 500,
            pointerEvents: 'none',
            opacity: 0.9,
          }}
        >
          {currentPage} / {numPages}
        </Box>
      )}

      {/* Loading State */}
      {loading && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
          <CircularProgress size={24} />
        </Box>
      )}

      {/* Error State */}
      {error && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
          <Typography variant="caption" color="error">{error}</Typography>
        </Box>
      )}

      {/* PDF Container */}
      <Box
        ref={containerRef}
        sx={{
          flex: 1,
          overflow: 'auto',
          display: loading || error ? 'none' : 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          py: 2,
          '& .react-pdf__Document': {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          },
          '& .react-pdf__Page': {
            mb: 1,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            bgcolor: 'white',
          },
          '& .react-pdf__Page__canvas': {
            display: 'block',
          },
          // Highlight search matches
          '& .react-pdf__Page__textContent mark': {
            bgcolor: 'rgba(255, 235, 59, 0.6)',
            color: 'inherit',
          },
        }}
      >
        <Document
          file={url}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={onDocumentLoadError}
          loading=""
        >
          {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => (
            <Box
              key={pageNum}
              ref={(el: HTMLDivElement | null) => {
                if (el) pageRefs.current.set(pageNum, el);
              }}
            >
              <Page
                pageNumber={pageNum}
                scale={scale}
                renderTextLayer={true}
                renderAnnotationLayer={true}
              />
            </Box>
          ))}
        </Document>
      </Box>
    </Box>
  );
});

PdfViewer.displayName = 'PdfViewer';
