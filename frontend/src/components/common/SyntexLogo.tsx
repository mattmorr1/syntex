import { Box, Typography } from '@mui/material';
import { useThemeStore } from '../../store/themeStore';

interface Props {
  size?: 'sm' | 'md';
}

export default function SyntexLogo({ size = 'sm' }: Props) {
  const { mode } = useThemeStore();
  const isDark = mode === 'dark';
  const dim = size === 'md' ? 26 : 20;
  const fontSize = size === 'md' ? 9 : 7.5;

  return (
    <Box
      sx={{
        width: dim,
        height: dim,
        bgcolor: isDark ? '#ffffff' : '#0a0a0a',
        borderRadius: '5px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <Typography
        sx={{
          color: isDark ? '#0a0a0a' : '#ffffff',
          fontWeight: 700,
          fontSize,
          fontFamily: '"IBM Plex Mono", "Courier New", monospace',
          lineHeight: 1,
          userSelect: 'none',
          letterSpacing: '-0.02em',
        }}
      >
        {'</>'}
      </Typography>
    </Box>
  );
}
