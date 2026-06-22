import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { ThemeColors } from '../theme/colors';

interface IdentityCardProps {
  fullName: string;
  email: string;
  profilePicUrl?: string | null;
  theme: ThemeColors;
}

export const IdentityCard: React.FC<IdentityCardProps> = ({ fullName, email, profilePicUrl, theme }) => {
  const styles = useMemo(() => getStyles(theme), [theme]);
  return (
    <View style={styles.card}>
      <View style={styles.contentRow}>
        <View style={styles.profileContainer}>
            {profilePicUrl ? (
                <Image source={{ uri: profilePicUrl }} style={styles.profileImage} />
            ) : (
                <MaterialIcons name="person" size={32} color={theme.primary} />
            )}
        </View>
        
        <View style={styles.textContainer}>
            <Text style={styles.name} numberOfLines={2}>{fullName}</Text>
            <Text style={styles.email} numberOfLines={1}>{email}</Text>
        </View>
      </View>

      <View style={styles.badgeContainer}>
        <View style={styles.badgeContent}>
            <MaterialIcons name="check-circle" size={16} color={theme.success} />
            <Text style={styles.badgeText}>Official Verified Citizen</Text>
        </View>
      </View>
    </View>
  );
};

const getStyles = (theme: ThemeColors) => StyleSheet.create({
  card: {
    backgroundColor: theme.surface,
    borderRadius: 24,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: theme.border,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  profileContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.btnSecondaryBg, 
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  profileImage: {
    width: '100%',
    height: '100%',
  },
  textContainer: {
    flex: 1,
    marginLeft: 16,
  },
  name: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.textPrimary,
    marginBottom: 2,
  },
  email: {
    fontSize: 13,
    color: theme.textSecondary,
    opacity: 0.6,
  },
  badgeContainer: {
      backgroundColor: theme.successContainer, 
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.successContainer, // Simplify or match border
      paddingVertical: 8,
      alignItems: 'center',
  },
  badgeContent: {
      flexDirection: 'row',
      alignItems: 'center',
  },
  badgeText: {
      fontSize: 12,
      fontWeight: 'bold',
      color: theme.success,
      marginLeft: 8,
  }
});
