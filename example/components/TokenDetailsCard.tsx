import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { ThemeColors } from '../theme/colors';

interface TokenDetailsCardProps {
  idClaims: Record<string, any>;
  accessClaims: Record<string, any>;
  theme: ThemeColors;
}

export const TokenDetailsCard: React.FC<TokenDetailsCardProps> = ({ idClaims, accessClaims, theme }) => {
  const styles = useMemo(() => getStyles(theme), [theme]);
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.header} onPress={() => setExpanded(!expanded)}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <MaterialIcons name="lock" size={20} color={theme.primary} />
            <Text style={styles.title}>Token Details</Text>
        </View>
        <MaterialIcons 
            name={expanded ? "keyboard-arrow-up" : "keyboard-arrow-down"} 
            size={20} 
            color={theme.textCaption} 
        />
      </TouchableOpacity>

      {expanded && (
          <View style={styles.content}>
              <ClaimSection title="ID Token Claims" data={idClaims} styles={styles} />
              <ClaimSection title="Access Token Claims" data={accessClaims} styles={styles} />
          </View>
      )}
    </View>
  );
};

const ClaimSection = ({ title, data, styles }: { title: string, data: Record<string, any>, styles: any }) => (
    <View style={{ marginBottom: 12 }}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <View style={styles.claimsBox}>
            {Object.entries(data).map(([key, value]) => (
                <View key={key} style={styles.claimRow}>
                    <Text style={styles.claimKey}>{key}:</Text>
                    <Text style={styles.claimValue}>{String(value)}</Text>
                </View>
            ))}
        </View>
    </View>
);

const getStyles = (theme: ThemeColors) => StyleSheet.create({
  card: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  title: {
    fontWeight: 'bold',
    fontSize: 14,
    color: theme.textPrimary,
    marginLeft: 12,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  sectionTitle: {
      fontSize: 12,
      fontWeight: 'bold',
      color: theme.primary,
      marginBottom: 8,
  },
  claimsBox: {
      backgroundColor: theme.surfaceVariant + '33',
      borderRadius: 12,
      padding: 12,
      marginBottom: 8,
  },
  claimRow: {
      flexDirection: 'row',
      marginBottom: 2,
  },
  claimKey: {
      width: 100,
      fontSize: 11,
      fontWeight: 'bold',
      color: theme.textPrimary,
  },
  claimValue: {
      flex: 1,
      fontSize: 11,
      color: theme.textPrimary,
      opacity: 0.8,
  }
});
