import { Box, Text } from 'ink';
import type { TuiMode } from './input.js';

export interface FooterProps {
  mode: TuiMode;
  rowCount: number;
  guidance: string | null;
  plain: boolean;
}

export interface FooterRegions {
  guidance: string | null;
  hints: string;
}

export function footerRegions(
  mode: TuiMode,
  rowCount: number,
  guidance: string | null,
): FooterRegions {
  const numbered = Math.min(9, Math.max(0, rowCount));
  const rerun = numbered === 0 ? '' : `1-${numbered} re-run  `;
  return {
    guidance,
    hints:
      mode === 'detail'
        ? '←/→ playback older/newer   r re-run   esc back'
        : `${rerun}↑↓ select  ⏎ details  a run all  s snapshot  c clear+rerun  w close  q quit sensors`,
  };
}

export function Footer({ mode, rowCount, guidance, plain }: FooterProps) {
  const regions = footerRegions(mode, rowCount, guidance);
  return (
    <Box marginTop={1} flexDirection="column">
      {regions.guidance && (
        <Box>
          <Text color={plain ? undefined : 'yellow'} wrap="truncate-end">
            {`→ ${regions.guidance}`}
          </Text>
        </Box>
      )}
      <Box>
        <Text dimColor>{regions.hints}</Text>
      </Box>
    </Box>
  );
}
