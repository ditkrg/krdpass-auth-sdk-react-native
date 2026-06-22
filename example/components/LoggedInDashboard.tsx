import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { ThemeColors } from '../theme/colors';
import { IdentityCard } from './IdentityCard';
import { PersonalDetailCard } from './PersonalDetailCard';
import { UserInfoProtocolCard } from './UserInfoProtocolCard';
import { TokenDetailsCard } from './TokenDetailsCard';
import { TokenManagementCard } from './TokenManagementCard';

interface LoggedInDashboardProps {
  claims: Record<string, any>;
  idClaims: Record<string, any>;
  accessClaims: Record<string, any>;
  userInfo: any;
  isLoadingUserInfo: boolean;
  onFetchUserInfo: () => void;
  onLogout: () => void;
  onVerifyToken: () => void;
  onRefreshToken: () => void;
  onRevokeToken: () => void;
  theme: ThemeColors;
  actionMessage?: string | null;
}

export const LoggedInDashboard: React.FC<LoggedInDashboardProps> = ({
    claims,
    idClaims,
    accessClaims,
    userInfo,
    isLoadingUserInfo,
    onFetchUserInfo,
    onLogout,
    onVerifyToken,
    onRefreshToken,
    onRevokeToken,
    theme,
    actionMessage
}) => {
    const styles = useMemo(() => getStyles(theme), [theme]);

    // Identity resolution (matching Android logic)
    const fullName = userInfo?.citizenFullName || [
        claims["citizen_first"],
        claims["citizen_second"],
        claims["citizen_third"],
        claims["citizen_surname"]
    ].filter(Boolean).join(" ") || claims["upn"] || "Citizen User";

    const citizenFirst = userInfo?.citizenFirst || claims["citizen_first"] || "Citizen";
    const email = userInfo?.email || claims["email"] || claims["upn"] || "No email";
    const birthdate = userInfo?.birthdate || claims["birthdate"];
    const sex = userInfo?.sexAtBirth || claims["sex_at_birth"];
    const profilePicUrl = userInfo?.picture || claims["citizen_profile_picture"] || idClaims["citizen_profile_picture"];

  return (
    <SafeAreaView style={styles.container}>
      {/* App Bar */}
      <View style={styles.appBar}>
        <View style={{ flex: 1 }}>
            <Text style={styles.welcomeLabel}>Welcome,</Text>
            <Text style={styles.welcomeName}>{citizenFirst}</Text>
        </View>
        <TouchableOpacity style={styles.logoutButton} onPress={onLogout}>
            <MaterialIcons name="exit-to-app" size={20} color={theme.error} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Identity Card */}
        <IdentityCard 
            fullName={fullName}
            email={email}
            profilePicUrl={profilePicUrl}
            theme={theme}
        />

        {/* Personal Details */}
        <Text style={styles.sectionHeader}>Personal Details</Text>
        <View style={styles.detailsRow}>
            <PersonalDetailCard 
                icon="date-range"
                label="Birth Date"
                value={birthdate || "N/A"}
                theme={theme}
            />
            <View style={{ width: 12 }} />
            <PersonalDetailCard 
                icon="account-circle"
                label="Gender"
                value={sex || "N/A"}
                theme={theme}
            />
        </View>

        <View style={{ height: 24 }} />

        {/* User Info Protocol */}
        <UserInfoProtocolCard 
            isLoading={isLoadingUserInfo}
            userInfo={userInfo}
            onFetchUserInfo={onFetchUserInfo}
            theme={theme}
        />

        <View style={{ height: 16 }} />

        {/* Token Details */}
        <TokenDetailsCard 
            idClaims={idClaims}
            accessClaims={accessClaims}
            theme={theme}
        />

        <View style={{ height: 16 }} />

        {/* Token Management */}
        <TokenManagementCard 
            onVerifyToken={onVerifyToken}
            onRefreshToken={onRefreshToken}
            onRevokeToken={onRevokeToken}
            theme={theme}
            actionMessage={actionMessage}
        />
        
        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const getStyles = (theme: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  welcomeLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.textSecondary,
    opacity: 0.6,
  },
  welcomeName: {
    fontSize: 24,
    fontWeight: '900',
    color: theme.textPrimary,
  },
  logoutButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: theme.errorContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  sectionHeader: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
    marginTop: 8,
    color: theme.textPrimary,
  },
  detailsRow: {
    flexDirection: 'row',
  }
});
