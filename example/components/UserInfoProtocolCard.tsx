import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { ThemeColors } from '../theme/colors';

interface UserInfoProtocolCardProps {
  isLoading: boolean;
  userInfo: any;
  onFetchUserInfo: () => void;
  theme: ThemeColors;
}

export const UserInfoProtocolCard: React.FC<UserInfoProtocolCardProps> = ({ 
    isLoading, 
    userInfo, 
    onFetchUserInfo,
    theme
}) => {
  const styles = useMemo(() => getStyles(theme), [theme]);
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.header} onPress={() => setExpanded(!expanded)}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <MaterialIcons name="refresh" size={20} color={theme.primary} />
            <Text style={styles.title}>Remote User Info Protocol</Text>
        </View>
        <MaterialIcons 
            name={expanded ? "keyboard-arrow-up" : "keyboard-arrow-down"} 
            size={20} 
            color={theme.textCaption} 
        />
      </TouchableOpacity>

      {expanded && (
          <View style={styles.content}>
              <Text style={styles.description}>
                Fetch the latest profile data directly from the OIDC UserInfo endpoint using your Access Token.
              </Text>

              <TouchableOpacity 
                style={[styles.syncButton, isLoading && styles.disabledButton]} 
                onPress={isLoading ? undefined : onFetchUserInfo}
                disabled={isLoading}
              >
                  {isLoading ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <ActivityIndicator size="small" color="#FFF" />
                          <Text style={styles.syncButtonText}>Syncing...</Text>
                      </View>
                  ) : (
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <MaterialIcons name="refresh" size={18} color="#FFF" />
                          <Text style={styles.syncButtonText}>Sync with Remote UserInfo</Text>
                      </View>
                  )}
              </TouchableOpacity>

              {userInfo && (
                  <View>
                      <View style={styles.successBadge}>
                          <MaterialIcons name="check-circle" size={18} color={theme.success} />
                          <Text style={styles.successText}>Successfully synced!</Text>
                      </View>
                      
                      <View style={styles.claimsContainer}>
                        <Text style={styles.claimsTitle}>UserInfo Claims</Text>
                        <View style={styles.claimsBox}>
                            {Object.entries(userInfo).map(([key, value]) => (
                                <View key={key} style={styles.claimRow}>
                                    <Text style={styles.claimKey}>{key}:</Text>
                                    <Text style={styles.claimValue}>{String(value)}</Text>
                                </View>
                            ))}
                        </View>
                      </View>
                  </View>
              )}
          </View>
      )}
    </View>
  );
};

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
    paddingBottom: 16,
  },
  description: {
    fontSize: 12,
    color: theme.textSecondary,
    marginBottom: 16,
  },
  syncButton: {
    backgroundColor: theme.primary,
    borderRadius: 12,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  disabledButton: {
    opacity: 0.7,
  },
  syncButtonText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  successBadge: {
    backgroundColor: theme.successContainer,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  successText: {
    color: theme.success,
    fontSize: 12,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  claimsContainer: {
     marginTop: 4,
  },
  claimsTitle: {
      fontSize: 12,
      fontWeight: 'bold',
      color: theme.primary,
      marginBottom: 8,
  },
  claimsBox: {
      backgroundColor: theme.surfaceVariant + '33', // 20% alpha
      borderRadius: 12,
      padding: 12,
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
