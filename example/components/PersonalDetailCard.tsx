import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { ThemeColors } from '../theme/colors';

interface PersonalDetailCardProps {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  value: string;
  theme: ThemeColors;
}

export const PersonalDetailCard: React.FC<PersonalDetailCardProps> = ({ icon, label, value, theme }) => {
  const styles = useMemo(() => getStyles(theme), [theme]);
  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <MaterialIcons name={icon} size={16} color={theme.primary} style={{ opacity: 0.7 }} />
        <Text style={styles.label}>{label}</Text>
      </View>
      <Text style={styles.value} numberOfLines={1}>{value}</Text>
    </View>
  );
};

const getStyles = (theme: ThemeColors) => StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: theme.surfaceVariant + '4D', // 30% alpha roughly
    borderRadius: 16,
    padding: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  label: {
      fontSize: 12,
      color: theme.textCaption,
      marginLeft: 8,
  },
  value: {
      fontSize: 14,
      fontWeight: 'bold',
      color: theme.textPrimary,
  }
});
