import {
  ConfigPlugin,
  withAndroidManifest,
  withDangerousMod,
  AndroidConfig,
} from "@expo/config-plugins";
import * as fs from "fs";
import * as path from "path";

// The KRDPASS native iOS core this module depends on. It is not on the CocoaPods trunk,
// so the host Podfile must declare its git source. Keep the tag in step with the core release.
const KRDPASS_AUTH_POD =
  "pod 'KrdpassAuth', :git => 'https://github.com/ditkrg/krdpass-auth-sdk-ios.git', :tag => 'v1.1.0'";
const KRDPASS_AUTH_GIT_POD =
  /^\s*pod\s+['"]KrdpassAuth['"]\s*,\s*:git\s*=>\s*['"]https:\/\/github\.com\/ditkrg\/krdpass-auth-sdk-ios\.git['"].*$/m;

const withKrdPassAuth: ConfigPlugin = (config) => {
  config = withAndroidConfig(config);
  // iOS needs no Info.plist changes: KRDPASS registers no custom URL scheme (Universal Link
  // only), and the app's own associated domains are app-specific host-app config. The only
  // iOS wiring is the KrdpassAuth pod source below.
  config = withKrdpassPodSource(config);
  return config;
};

/**
 * Inject the KrdpassAuth pod's git source into the prebuild-generated Podfile,
 * or update an older KRDPASS git tag left by a previous plugin release. A
 * deliberate local `:path` override is preserved for SDK development.
 */
const withKrdpassPodSource: ConfigPlugin = (config) => {
  return withDangerousMod(config, [
    "ios",
    async (config) => {
      const podfilePath = path.join(
        config.modRequest.platformProjectRoot,
        "Podfile"
      );
      const contents = fs.readFileSync(podfilePath, "utf8");
      const updatedContents = KRDPASS_AUTH_GIT_POD.test(contents)
        ? contents.replace(KRDPASS_AUTH_GIT_POD, `  ${KRDPASS_AUTH_POD}`)
        : contents.includes("pod 'KrdpassAuth'")
        ? contents
        : contents.replace(
            /use_expo_modules!/,
            `use_expo_modules!\n\n  # KRDPASS native iOS core (added by krdpass-auth-react-native's config plugin).\n  ${KRDPASS_AUTH_POD}`
          );
      if (updatedContents !== contents) {
        fs.writeFileSync(podfilePath, updatedContents);
      }
      return config;
    },
  ]);
};

const withAndroidConfig: ConfigPlugin = (config) => {
  return withAndroidManifest(config, (config) => {
    // 1. Set launchMode="singleTask" on MainActivity
    const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(
      config.modResults
    );
    mainActivity.$["android:launchMode"] = "singleTask";

    // 2. Add <queries> for KRDPASS packages
    if (!config.modResults.manifest.queries) {
      config.modResults.manifest.queries = [];
    }

    // Check if already exists to avoid duplicates
    const queries = config.modResults.manifest.queries;
    const packageIds = ["krd.pass", "krd.pass.dev"];
    const existingPackages = new Set(
      queries.flatMap((q: any) =>
        (q.package || []).map((p: any) => p.$?.["android:name"])
      )
    );

    packageIds.forEach((packageId) => {
      if (!existingPackages.has(packageId)) {
        queries.push({
          package: [{ $: { "android:name": packageId } }],
        });
      }
    });

    return config;
  });
};

export default withKrdPassAuth;
