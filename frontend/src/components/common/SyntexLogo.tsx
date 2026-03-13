import { Box, Typography } from '@mui/material';

interface Props {
  size?: 'sm' | 'md';
}

export default function SyntexLogo({ size = 'sm' }: Props) {
  const dim = size === 'md' ? 26 : 20;
  const fontSize = size === 'md' ? 9 : 7.5;

  return (
    <Box
      sx={{
        width: dim,
        height: dim,
        bgcolor: 'white',
        borderRadius: '5px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <Typography
        sx={{
          color: '#0a0a0a',
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
