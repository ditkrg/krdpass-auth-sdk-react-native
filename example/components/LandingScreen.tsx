import React, { useMemo } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  ScrollView, 
  SafeAreaView, 
  TouchableOpacity, 
  Switch,
  ActivityIndicator,
} from 'react-native';
import { ThemeColors } from '../theme/colors';
import { KrdPassIcon } from '../assets/krdpass_icon';
import { MaterialIcons } from '@expo/vector-icons';

interface LandingScreenProps {
  loading: boolean;
  error?: string | null;
  citizenScope: boolean;
  offlineScope: boolean;
  useServerMode: boolean;
  onCitizenScopeChange: (val: boolean) => void;
  onOfflineScopeChange: (val: boolean) => void;
  onServerModeChange: (val: boolean) => void;
  onSignIn: () => void;
  onClearError?: () => void;
  theme: ThemeColors;
}

export const LandingScreen: React.FC<LandingScreenProps> = ({ 
  loading, 
  error,
  citizenScope, 
  offlineScope, 
  useServerMode, 
  onCitizenScopeChange, 
  onOfflineScopeChange, 
  onServerModeChange, 
  onSignIn,
  onClearError,
  theme
}) => {
  const styles = useMemo(() => getStyles(theme), [theme]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.landingContent}>
        
        {/* Logo Section */}
        <View style={styles.logoContainer}>
            <View style={styles.logoCircle}>
               <MaterialIcons name="lock" size={36} color="#FFF" />
            </View>
            <Text style={styles.appTitle}>KRDPass</Text>
            <Text style={styles.appSubtitle}>Digital Identity Demo</Text>
        </View>

        {/* Error Card */}
        {error && (
            <View style={styles.errorCard}>
                <MaterialIcons name="warning" size={20} color={theme.error} />
                <Text style={styles.errorText}>{error}</Text>
                {onClearError && (
                    <TouchableOpacity onPress={onClearError}>
                        <MaterialIcons name="close" size={20} color={theme.error} />
                    </TouchableOpacity>
                )}
            </View>
        )}

        {/* Configuration Card */}
        <View style={styles.card}>
          <ConfigToggle 
            title="Citizen Data" 
            subtitle="Include citizen_identity scope"
            value={citizenScope}
            onValueChange={onCitizenScopeChange}
            theme={theme}
          />
          <View style={styles.divider} />
          
          <ConfigToggle 
            title="Offline Access" 
            subtitle="Include offline_access scope (Refresh Token)"
            value={offlineScope}
            onValueChange={onOfflineScopeChange}
            theme={theme}
          />
          <View style={styles.divider} />

          <ConfigToggle 
            title="Auth Mode" 
            subtitle={useServerMode ? "Backend-mediated (Secure)" : "Direct (Client-only)"}
            value={useServerMode}
            onValueChange={onServerModeChange}
            subtitleColor={theme.primary}
            theme={theme}
          />
        </View>

        {/* Sign In Button */}
        <TouchableOpacity 
          style={[styles.primaryButton, loading && styles.disabledButton]} 
          onPress={loading ? undefined : onSignIn}
          disabled={loading}
        >
          {loading ? (
             <ActivityIndicator color="#FFF" />
          ) : (
             <View style={styles.btnContent}>
               <KrdPassIcon color="#FFF" size={20} />
               <Text style={styles.primaryButtonText}>Sign in with KRDPASS</Text>
             </View>
          )}
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
};

const ConfigToggle = ({ title, subtitle, value, onValueChange, subtitleColor, theme }: any) => {
  const styles = useMemo(() => getStyles(theme), [theme]);
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleTextContainer}>
        <Text style={styles.toggleTitle}>{title}</Text>
        <Text style={[styles.toggleSubtitle, subtitleColor && { color: subtitleColor }]}>{subtitle}</Text>
      </View>
      <Switch 
        value={value} 
        onValueChange={onValueChange} 
        trackColor={{ false: "#767577", true: theme.primary }}
        thumbColor={theme.background}
      />
    </View>
  );
};

const getStyles = (theme: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  landingContent: {
    padding: 24,
    flexGrow: 1,
    justifyContent: 'center',
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logoCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: theme.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  appTitle: {
    fontSize: 28,
    fontWeight: '900',
    color: theme.textPrimary,
    marginBottom: 4,
  },
  appSubtitle: {
    fontSize: 14,
    color: theme.textCaption,
  },
  card: {
    backgroundColor: theme.surface, 
    borderRadius: 24,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: theme.border, 
    marginBottom: 24,
  },
  errorCard: {
    backgroundColor: theme.errorContainer,
    borderRadius: 12,
    padding: 12,
    marginBottom: 24,
    flexDirection: 'row',
    alignItems: 'center',
  },
  errorText: {
    flex: 1,
    color: theme.error,
    fontSize: 12,
    marginHorizontal: 8,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  toggleTextContainer: {
    flex: 1,
    paddingRight: 16,
  },
  toggleTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: theme.textPrimary,
  },
  toggleSubtitle: {
    fontSize: 12,
    color: theme.textCaption,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: theme.border,
    opacity: 0.5,
  },
  primaryButton: {
    backgroundColor: theme.primary,
    borderRadius: 16,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  disabledButton: {
    opacity: 0.7,
  },
  btnContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 12,
  },
});
