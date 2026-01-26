import { createTheme, ThemeOptions } from '@mui/material/styles';

const commonComponents: ThemeOptions['components'] = {
  MuiButton: {
    styleOverrides: {
      root: {
        borderRadius: 20,
        textTransform: 'none',
        fontWeight: 500,
      },
    },
  },
  MuiCard: {
    styleOverrides: {
      root: {
        borderRadius: 16,
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
      main: '#B388FF',
      light: '#D1C4E9',
      dark: '#7C4DFF',
    },
    secondary: {
      main: '#82B1FF',
      light: '#B3E5FC',
      dark: '#448AFF',
    },
    background: {
      default: '#0D0D0D',
      paper: '#1A1A1A',
    },
    surface: {
      main: '#1E1E1E',
    },
    error: {
      main: '#FF5252',
    },
    success: {
      main: '#69F0AE',
    },
    text: {
      primary: '#FFFFFF',
      secondary: '#B0B0B0',
    },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h1: { fontWeight: 600 },
    h2: { fontWeight: 600 },
    h3: { fontWeight: 600 },
    h4: { fontWeight: 500 },
    h5: { fontWeight: 500 },
    h6: { fontWeight: 500 },
  },
  components: {
    ...commonComponents,
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          scrollbarColor: '#3d3d3d #1a1a1a',
          '&::-webkit-scrollbar, & *::-webkit-scrollbar': {
            width: 8,
            height: 8,
          },
          '&::-webkit-scrollbar-thumb, & *::-webkit-scrollbar-thumb': {
            borderRadius: 8,
            backgroundColor: '#3d3d3d',
          },
          '&::-webkit-scrollbar-track, & *::-webkit-scrollbar-track': {
            backgroundColor: '#1a1a1a',
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
      main: '#6750A4',
      light: '#9A82DB',
      dark: '#4F378B',
    },
    secondary: {
      main: '#625B71',
      light: '#958DA5',
      dark: '#4A4458',
    },
    background: {
      default: '#FFFBFE',
      paper: '#FFFFFF',
    },
    surface: {
      main: '#F7F2FA',
    },
    error: {
      main: '#B3261E',
    },
    success: {
      main: '#2E7D32',
    },
    text: {
      primary: '#1C1B1F',
      secondary: '#49454F',
    },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h1: { fontWeight: 600 },
    h2: { fontWeight: 600 },
    h3: { fontWeight: 600 },
    h4: { fontWeight: 500 },
    h5: { fontWeight: 500 },
    h6: { fontWeight: 500 },
  },
  components: commonComponents,
});

declare module '@mui/material/styles' {
  interface Palette {
    surface: Palette['primary'];
  }
  interface PaletteOptions {
    surface?: PaletteOptions['primary'];
  }
}
