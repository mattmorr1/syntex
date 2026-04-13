import { createTheme, ThemeOptions } from '@mui/material/styles';

const commonTypography: ThemeOptions['typography'] = {
  fontFamily: '"Work Sans", "Inter", "Helvetica", "Arial", sans-serif',
  h1: { fontWeight: 600 },
  h2: { fontWeight: 600 },
  h3: { fontWeight: 600 },
  h4: { fontWeight: 500 },
  h5: { fontWeight: 500 },
  h6: { fontWeight: 500 },
};

const commonComponents: ThemeOptions['components'] = {
  MuiButton: {
    styleOverrides: {
      root: {
        borderRadius: 8,
        textTransform: 'none',
        fontWeight: 500,
        fontSize: 12,
        letterSpacing: '0.02em',
      },
    },
  },
  MuiCard: {
    styleOverrides: {
      root: {
        borderRadius: 10,
      },
    },
  },
  MuiTextField: {
    defaultProps: {
      variant: 'outlined',
      size: 'small',
    },
  },
  MuiPaper: {
    styleOverrides: {
      root: {
        borderRadius: 10,
      },
    },
  },
};

export const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#ffffff',
      light: '#e4e4e7',
      dark: '#a1a1aa',
      contrastText: '#0a0a0a',
    },
    secondary: {
      main: '#71717a',
      light: '#a1a1aa',
      dark: '#52525b',
    },
    background: {
      default: '#0a0a0a',
      paper: '#121212',
    },
    surface: {
      main: '#1e1e1e',
    },
    border: {
      main: '#262626',
      subtle: '#1a1a1a',
    },
    error: {
      main: '#ef4444',
    },
    success: {
      main: '#22c55e',
    },
    warning: {
      main: '#f59e0b',
    },
    text: {
      primary: '#e4e4e7',
      secondary: '#71717a',
    },
    divider: '#262626',
  },
  typography: commonTypography,
  components: {
    ...commonComponents,
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          scrollbarColor: '#333333 transparent',
          '&::-webkit-scrollbar, & *::-webkit-scrollbar': {
            width: 5,
            height: 5,
          },
          '&::-webkit-scrollbar-thumb, & *::-webkit-scrollbar-thumb': {
            borderRadius: 10,
            backgroundColor: '#333333',
            '&:hover': {
              backgroundColor: '#444444',
            },
          },
          '&::-webkit-scrollbar-track, & *::-webkit-scrollbar-track': {
            backgroundColor: '#121212',
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          backgroundImage: 'none',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          border: '1px solid #262626',
          backgroundImage: 'none',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          textTransform: 'none',
          fontWeight: 500,
          fontSize: 12,
        },
        containedPrimary: {
          backgroundColor: '#ffffff',
          color: '#0a0a0a',
          '&:hover': {
            backgroundColor: '#e4e4e7',
          },
        },
        outlinedPrimary: {
          borderColor: '#262626',
          color: '#e4e4e7',
          '&:hover': {
            borderColor: '#3d3d3d',
            backgroundColor: 'rgba(255,255,255,0.04)',
          },
        },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: {
          border: '1px solid #262626',
          backgroundImage: 'none',
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: '#1e1e1e',
          border: '1px solid #262626',
          fontSize: 11,
        },
      },
    },
    MuiTextField: {
      defaultProps: {
        variant: 'outlined',
        size: 'small',
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: '#262626',
          },
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: '#3d3d3d',
          },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: '#ffffff',
            borderWidth: 1,
          },
        },
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: {
          borderColor: '#262626',
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          '&.Mui-selected': {
            backgroundColor: '#1e1e1e',
            borderLeft: '2px solid #ffffff',
            '&:hover': {
              backgroundColor: '#1e1e1e',
            },
          },
          '&:hover': {
            backgroundColor: 'rgba(255, 255, 255, 0.04)',
          },
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 8,
        },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          borderColor: '#262626',
          '&.Mui-selected': {
            backgroundColor: '#ffffff',
            color: '#0a0a0a',
            '&:hover': {
              backgroundColor: '#e4e4e7',
            },
          },
        },
      },
    },
  },
});

export const lightTheme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#0a0a0a',
      light: '#3d3d3d',
      dark: '#000000',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#71717a',
      light: '#a1a1aa',
      dark: '#52525b',
    },
    background: {
      default: '#fafafa',
      paper: '#ffffff',
    },
    surface: {
      main: '#f4f4f5',
    },
    border: {
      main: '#e4e4e7',
      subtle: '#f0f0f0',
    },
    error: {
      main: '#dc2626',
    },
    success: {
      main: '#16a34a',
    },
    warning: {
      main: '#d97706',
    },
    text: {
      primary: '#0a0a0a',
      secondary: '#71717a',
    },
    divider: '#e4e4e7',
  },
  typography: commonTypography,
  components: {
    ...commonComponents,
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          scrollbarColor: '#d4d4d8 transparent',
          '&::-webkit-scrollbar, & *::-webkit-scrollbar': {
            width: 5,
            height: 5,
          },
          '&::-webkit-scrollbar-thumb, & *::-webkit-scrollbar-thumb': {
            borderRadius: 10,
            backgroundColor: '#d4d4d8',
            '&:hover': {
              backgroundColor: '#a1a1aa',
            },
          },
          '&::-webkit-scrollbar-track, & *::-webkit-scrollbar-track': {
            backgroundColor: 'transparent',
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          backgroundImage: 'none',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          border: '1px solid #e4e4e7',
          backgroundImage: 'none',
        },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: {
          border: '1px solid #e4e4e7',
          backgroundImage: 'none',
          boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: '#18181b',
          color: '#e4e4e7',
          fontSize: 11,
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          textTransform: 'none',
          fontWeight: 500,
          fontSize: 12,
        },
        containedPrimary: {
          backgroundColor: '#0a0a0a',
          color: '#ffffff',
          '&:hover': {
            backgroundColor: '#1e1e1e',
          },
        },
        outlinedPrimary: {
          borderColor: '#e4e4e7',
          color: '#0a0a0a',
          '&:hover': {
            borderColor: '#a1a1aa',
            backgroundColor: 'rgba(0,0,0,0.04)',
          },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: '#a1a1aa',
          },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: '#0a0a0a',
            borderWidth: 1,
          },
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          '&.Mui-selected': {
            backgroundColor: '#f4f4f5',
            borderLeft: '2px solid #0a0a0a',
            '&:hover': {
              backgroundColor: '#f4f4f5',
            },
          },
          '&:hover': {
            backgroundColor: 'rgba(0, 0, 0, 0.04)',
          },
        },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          borderColor: '#e4e4e7',
          '&.Mui-selected': {
            backgroundColor: '#0a0a0a',
            color: '#ffffff',
            '&:hover': {
              backgroundColor: '#1e1e1e',
            },
          },
        },
      },
    },
  },
});

declare module '@mui/material/styles' {
  interface Palette {
    surface: Palette['primary'];
    border: {
      main: string;
      subtle: string;
    };
  }
  interface PaletteOptions {
    surface?: PaletteOptions['primary'];
    border?: {
      main: string;
      subtle: string;
    };
  }
}
