import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { ThemeColors } from '../theme/colors';

interface TokenManagementCardProps {
  onVerifyToken: () => void;
  onRefreshToken: () => void;
  onRevokeToken: () => void;
  theme: ThemeColors;
  actionMessage?: string | null;
}

export const TokenManagementCard: React.FC<TokenManagementCardProps> = ({ 
    onVerifyToken, 
    onRefreshToken, 
    onRevokeToken,
    theme,
    actionMessage
}) => {
  const styles = useMemo(() => getStyles(theme), [theme]);
  return (
    <View style={styles.card}>
      <View style={styles.header}>
            <MaterialIcons name="settings" size={20} color={theme.primary} />
            <Text style={styles.title}>Token Management</Text>
      </View>

      {actionMessage && (
        <View style={styles.statusContainer}>
           <MaterialIcons name="info" size={14} color={theme.textSecondary} />
           <Text style={styles.statusText}>{actionMessage}</Text>
        </View>
      )}

      <View style={styles.content}>
        <TokenButton 
            title="Verify Token Signature"
            bgColor={theme.btnSecondaryBg}
            textColor={theme.btnSecondaryText}
            onPress={onVerifyToken}
            styles={styles}
        />
        <TokenButton 
            title="Refresh Access Token"
            bgColor={theme.btnTertiaryBg}
            textColor={theme.btnTertiaryText}
            onPress={onRefreshToken}
            styles={styles}
        />
        <TokenButton 
            title="Revoke Token (Log Out)"
            bgColor={theme.btnDangerBg}
            textColor={theme.btnDangerText}
            onPress={onRevokeToken}
            styles={styles}
        />
      </View>
    </View>
  );
};

const TokenButton = ({ title, bgColor, textColor, onPress, styles }: any) => (
    <TouchableOpacity 
      style={[styles.button, { backgroundColor: bgColor }]} 
      onPress={onPress}
    >
      <Text style={[styles.buttonText, { color: textColor }]}>{title}</Text>
    </TouchableOpacity>
);

const getStyles = (theme: ThemeColors) => StyleSheet.create({
  card: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: 'hidden',
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontWeight: 'bold',
    fontSize: 14,
    color: theme.textPrimary,
    marginLeft: 12,
  },
  content: {
    gap: 8,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    paddingHorizontal: 4,
    gap: 6,
  },
  statusText: {
    fontSize: 12,
    color: theme.textSecondary,
  },
  button: {
      width: '100%',
      paddingVertical: 12,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 8,
  },
  buttonText: {
      fontSize: 12, // labelLarge
      fontWeight: '600',
  }
});
