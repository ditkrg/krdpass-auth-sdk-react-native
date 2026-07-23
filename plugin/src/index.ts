import {
  type ConfigPlugin,
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withPodfile,
} from "expo/config-plugins";

const { name: packageName, version: packageVersion } = require("../../package.json") as {
  name: string;
  version: string;
};

// The KRDPASS native iOS core this module depends on. It is not on the CocoaPods trunk,
// so the host Podfile must declare its git source. Keep the tag in step with the core release.
const KRDPASS_AUTH_POD =
  "pod 'KrdpassAuth', :git => 'https://github.com/ditkrg/krdpass-auth-sdk-ios.git', :tag => 'v1.1.0'";
const POD_BLOCK_START =
  "# @generated begin krdpass-auth-react-native - expo prebuild (DO NOT MODIFY)";
const POD_BLOCK_END =
  "# @generated end krdpass-auth-react-native";

const withKrdPassAuth: ConfigPlugin = (config) => {
  config = withAndroidConfig(config);
  // iOS needs no Info.plist changes: KRDPASS registers no custom URL scheme (Universal Link
  // only), and the app's own associated domains are app-specific host-app config. The only
  // iOS wiring is the KrdpassAuth pod source below.
  config = withKrdpassPodSource(config);
  return config;
};

/**
 * Inject the KrdpassAuth pod's git source into the prebuild-generated Podfile.
 * A deliberate local `:path` override or other host-managed KrdpassAuth pod is
 * preserved. This uses Expo's Podfile mod rather than a dangerous mod, so the
 * change participates in the normal prebuild lifecycle.
 */
const withKrdpassPodSource: ConfigPlugin = (config) => {
  return withPodfile(config, (config) => {
    config.modResults.contents = ensureKrdpassAuthPodSource(
      config.modResults.contents,
    );
    return config;
  });
};

/**
 * Add the iOS core pod to an Expo-generated Podfile without changing it on
 * subsequent prebuilds. Exported for focused unit tests.
 */
export function ensureKrdpassAuthPodSource(contents: string): string {
  const lineEnding = contents.includes("\r\n") ? "\r\n" : "\n";
  const hasTrailingLineEnding = contents.endsWith(lineEnding);
  const lines = contents.split(lineEnding);
  if (hasTrailingLineEnding) {
    lines.pop();
  }

  // A local :path pod is intentionally used by SDK contributors. Any other
  // host-managed KrdpassAuth declaration also takes precedence over the plugin.
  const existingPod = lines.find(isKrdpassAuthPod);
  if (existingPod && !isKrdpassAuthGitPod(existingPod)) {
    return contents;
  }

  const generatedBlockStart = lines.findIndex(
    (line) => line.trim() === POD_BLOCK_START,
  );
  const generatedBlockEnd = lines.findIndex(
    (line) => line.trim() === POD_BLOCK_END,
  );
  if (generatedBlockStart !== -1 && generatedBlockEnd > generatedBlockStart) {
    const indent = leadingWhitespace(lines[generatedBlockStart]);
    lines.splice(
      generatedBlockStart,
      generatedBlockEnd - generatedBlockStart + 1,
      ...podBlock(indent),
    );
    return joinLines(lines, lineEnding, hasTrailingLineEnding);
  }

  // Upgrade the unmarked declaration emitted by earlier plugin versions.
  const oldGitPodIndex = lines.findIndex(isKrdpassAuthGitPod);
  if (oldGitPodIndex !== -1) {
    lines[oldGitPodIndex] = `${leadingWhitespace(lines[oldGitPodIndex])}${KRDPASS_AUTH_POD}`;
    return joinLines(lines, lineEnding, hasTrailingLineEnding);
  }

  const useExpoModulesIndex = lines.findIndex((line) =>
    line.trimStart().startsWith("use_expo_modules!"),
  );
  if (useExpoModulesIndex === -1) {
    throw new Error(
      "Unable to add KrdpassAuth to the Podfile: expected use_expo_modules! in the Expo iOS target.",
    );
  }

  const indent = leadingWhitespace(lines[useExpoModulesIndex]);
  lines.splice(useExpoModulesIndex + 1, 0, "", ...podBlock(indent), "");
  return joinLines(lines, lineEnding, hasTrailingLineEnding);
}

function podBlock(indent: string): string[] {
  return [
    `${indent}${POD_BLOCK_START}`,
    `${indent}${KRDPASS_AUTH_POD}`,
    `${indent}${POD_BLOCK_END}`,
  ];
}

function isKrdpassAuthPod(line: string): boolean {
  const declaration = line.trimStart();
  return (
    declaration.startsWith("pod 'KrdpassAuth'") ||
    declaration.startsWith('pod "KrdpassAuth"')
  );
}

function isKrdpassAuthGitPod(line: string): boolean {
  return (
    isKrdpassAuthPod(line) &&
    line.includes("https://github.com/ditkrg/krdpass-auth-sdk-ios.git")
  );
}

function leadingWhitespace(line: string): string {
  return line.slice(0, line.length - line.trimStart().length);
}

function joinLines(
  lines: string[],
  lineEnding: string,
  hasTrailingLineEnding: boolean,
): string {
  const joined = lines.join(lineEnding);
  return hasTrailingLineEnding ? `${joined}${lineEnding}` : joined;
}

const withAndroidConfig: ConfigPlugin = (config) => {
  return withAndroidManifest(config, (config) => {
    // 1. Set launchMode="singleTask" on MainActivity
    const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(
      config.modResults,
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
        (q.package || []).map((p: any) => p.$?.["android:name"]),
      ),
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

export default createRunOncePlugin(
  withKrdPassAuth,
  packageName,
  packageVersion,
);
