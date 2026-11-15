// Mic glyph exported from Figma (v3 "Microphone glyph"); stop square and speaker drawn to match.
const Svg = ({ children }) => (
  <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const MicIcon = () => (
  <Svg>
    <path d="M25 8.33C25 5.57 22.76 3.33 20 3.33S15 5.57 15 8.33V18.33C15 21.09 17.24 23.33 20 23.33S25 21.09 25 18.33V8.33Z" />
    <path d="M31.67 16.67V20C31.67 23.09 30.44 26.06 28.25 28.25 26.06 30.44 23.09 31.67 20 31.67S13.94 30.44 11.75 28.25C9.56 26.06 8.33 23.09 8.33 20V16.67M20 31.67V36.67M13.33 36.67H26.67" />
  </Svg>
);

export const StopIcon = () => <Svg><rect x="12" y="12" width="16" height="16" rx="3" fill="currentColor" /></Svg>;

export const SpeakerIcon = () => (
  <Svg>
    <path d="M4 14H10L18 7V33L10 26H4Z" />
    <path d="M24 14C27 17 27 23 24 26M28 9C34 15 34 25 28 31" />
  </Svg>
);

export const Dots = () => <span className="dots" aria-hidden="true"><i /><i /><i /></span>;
