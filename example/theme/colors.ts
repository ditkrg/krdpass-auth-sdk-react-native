// Core Palette
const PALETTE = {
  krdpassBlue: '#00AAFF',
  krdpassLightBlue: '#F1FAFF',
  krdpassDarkText: '#1E1E1E',
  krdpassError: '#FF001D',
  krdpassSuccess: '#00CE2A',
  
  white: '#FFFFFF',
  black: '#000000',
  darkGrey: '#121212',
  midGrey: '#1E1E1E',
  lightGrey: '#F0F0F0',
  greyText: '#666666',
  captionText: '#8E8E93',
  border: '#E5E5EA',
  darkBorder: '#333333',
  
  errorContainer: '#FFE5E5',
  errorContainerDark: '#3E1C1C',
  successContainer: '#E5FAE5',
  successContainerDark: '#1C3E1C',
};

export const LightColors = {
  primary: PALETTE.krdpassBlue,
  background: PALETTE.white,
  surface: PALETTE.krdpassLightBlue,
  surfaceVariant: PALETTE.lightGrey,
  textPrimary: PALETTE.krdpassDarkText,
  textSecondary: PALETTE.greyText,
  textCaption: PALETTE.captionText,
  border: PALETTE.border,
  error: PALETTE.krdpassError,
  success: PALETTE.krdpassSuccess,
  
  errorContainer: PALETTE.errorContainer,
  successContainer: PALETTE.successContainer,
  
  btnSecondaryBg: PALETTE.krdpassLightBlue,
  btnSecondaryText: PALETTE.krdpassBlue,
  btnTertiaryBg: PALETTE.successContainer,
  btnTertiaryText: PALETTE.krdpassSuccess,
  btnDangerBg: PALETTE.errorContainer,
  btnDangerText: PALETTE.krdpassError,
};

export const DarkColors = {
  primary: PALETTE.krdpassBlue,
  background: PALETTE.darkGrey,
  surface: PALETTE.midGrey,
  surfaceVariant: '#2C2C2E',
  textPrimary: '#FFFFFF',
  textSecondary: '#AAAAAA',
  textCaption: '#8E8E93',
  border: PALETTE.darkBorder,
  error: '#FF453A', // iOS Dark Mode Error
  success: '#32D74B', // iOS Dark Mode Success
  
  errorContainer: PALETTE.errorContainerDark,
  successContainer: PALETTE.successContainerDark,
  
  btnSecondaryBg: '#1A2A33', // Darker blue tint
  btnSecondaryText: '#40C0FF',
  btnTertiaryBg: PALETTE.successContainerDark,
  btnTertiaryText: '#32D74B',
  btnDangerBg: PALETTE.errorContainerDark,
  btnDangerText: '#FF453A',
};

export type ThemeColors = typeof LightColors;

// Default export for backward compatibility during migration
export const COLORS = LightColors;
