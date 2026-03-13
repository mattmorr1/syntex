import { createTheme, ThemeOptions } from '@mui/material/styles';

const commonTypography: ThemeOptions['typography'] = {
  fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
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
      },
    },
  },
  MuiCard: {
    styleOverrides: {
      root: {
        borderRadius: 12,
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
        borderRadius: 12,
      },
    },
  },
};

export const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#7c3aed',
      light: '#a78bfa',
      dark: '#6d28d9',
    },
    secondary: {
      main: '#a5b4fc',
      light: '#c7d2fe',
      dark: '#818cf8',
    },
    background: {
      default: '#09090b',
      paper: '#18181b',
    },
    surface: {
      main: '#27272a',
    },
    border: {
      main: '#3f3f46',
      purple: '#4c1d95',
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
      secondary: '#a1a1aa',
    },
    divider: '#3f3f46',
  },
  typography: commonTypography,
  components: {
    ...commonComponents,
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          scrollbarColor: '#27272a transparent',
          '&::-webkit-scrollbar, & *::-webkit-scrollbar': {
            width: 6,
            height: 6,
          },
          '&::-webkit-scrollbar-thumb, & *::-webkit-scrollbar-thumb': {
            borderRadius: 3,
            backgroundColor: '#27272a',
            '&:hover': {
              backgroundColor: '#3f3f46',
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
          borderRadius: 12,
          backgroundImage: 'none',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          border: '1px solid #4c1d95',
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
        },
        containedPrimary: {
          '&:hover': {
            backgroundColor: '#6d28d9',
          },
        },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: {
          border: '1px solid #3f3f46',
          backgroundImage: 'none',
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: '#27272a',
          border: '1px solid #3f3f46',
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
            borderColor: '#3f3f46',
          },
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: '#7c3aed',
          },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: '#7c3aed',
          },
        },
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: {
          borderColor: '#3f3f46',
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          '&.Mui-selected': {
            backgroundColor: '#27272a',
            borderLeft: '2px solid #7c3aed',
            '&:hover': {
              backgroundColor: '#27272a',
            },
          },
          '&:hover': {
            backgroundColor: 'rgba(124, 58, 237, 0.08)',
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
  },
});

export const lightTheme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#6d28d9',
      light: '#8b5cf6',
      dark: '#5b21b6',
    },
    secondary: {
      main: '#625B71',
      light: '#958DA5',
      dark: '#4A4458',
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
      purple: '#ddd6fe',
    },
    error: {
      main: '#dc2626',
    },
    success: {
      main: '#16a34a',
    },
    text: {
      primary: '#18181b',
      secondary: '#52525b',
    },
    divider: '#e4e4e7',
  },
  typography: commonTypography,
  components: {
    ...commonComponents,
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          border: '1px solid #e4e4e7',
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: '#6d28d9',
          },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: '#6d28d9',
          },
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          '&.Mui-selected': {
            backgroundColor: '#f4f4f5',
            borderLeft: '2px solid #6d28d9',
          },
          '&:hover': {
            backgroundColor: 'rgba(109, 40, 217, 0.04)',
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
      purple: string;
    };
  }
  interface PaletteOptions {
    surface?: PaletteOptions['primary'];
    border?: {
      main: string;
      purple: string;
    };
  }
}
