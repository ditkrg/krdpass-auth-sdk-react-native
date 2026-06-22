import {
  ConfigPlugin,
  withAndroidManifest,
  withInfoPlist,
  AndroidConfig,
} from '@expo/config-plugins';

const withKrdPassAuth: ConfigPlugin = (config) => {
  config = withAndroidConfig(config);
  config = withIosConfig(config);
  return config;
};

const withAndroidConfig: ConfigPlugin = (config) => {
  return withAndroidManifest(config, (config) => {
    // 1. Set launchMode="singleTask" on MainActivity
    const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(config.modResults);
    mainActivity.$['android:launchMode'] = 'singleTask';

    // 2. Add <queries> for KRDPass packages
    if (!config.modResults.manifest.queries) {
      config.modResults.manifest.queries = [];
    }
    
    // Check if already exists to avoid duplicates
    const queries = config.modResults.manifest.queries;
    const packageIds = ['krd.pass', 'krd.pass.staging', 'krd.pass.dev'];
    const existingPackages = new Set(
      queries.flatMap((q: any) => (q.package || []).map((p: any) => p.$?.['android:name']))
    );

    packageIds.forEach((packageId) => {
      if (!existingPackages.has(packageId)) {
        queries.push({
          package: [{ $: { 'android:name': packageId } }]
        });
      }
    });

    return config;
  });
};

const withIosConfig: ConfigPlugin = (config) => {
  config = withInfoPlist(config, (config) => {
    // 1. Add LSApplicationQueriesSchemes
    if (!config.modResults.LSApplicationQueriesSchemes) {
      config.modResults.LSApplicationQueriesSchemes = [];
    }
    if (!config.modResults.LSApplicationQueriesSchemes.includes('krdpass')) {
      config.modResults.LSApplicationQueriesSchemes.push('krdpass');
    }
    return config;
  });
  
  // Associated domains must remain app-specific; configure them in the host app config.
  
  return config;
};

export default withKrdPassAuth;
