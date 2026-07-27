import {
  type ConfigPlugin,
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withPodfile,
} from "expo/config-plugins";

import { ensureKrdpassAuthPodSource } from "./podfile";

const { name: packageName, version: packageVersion } = require("../../package.json") as {
  name: string;
  version: string;
};

const withKrdPassAuth: ConfigPlugin = (config) => {
  config = withAndroidConfig(config);
  // iOS needs no Info.plist changes: KRDPASS is Universal Link only (no custom URL scheme), and
  // associated domains are host-app config. The pod source below is the only iOS wiring.
  config = withKrdpassPodSource(config);
  return config;
};

/**
 * Inject the KrdpassAuth pod's git source into the prebuild-generated Podfile, preserving a
 * local `:path` override or any other host-managed KrdpassAuth pod. Uses Expo's Podfile mod,
 * not a dangerous mod, so it participates in the normal prebuild lifecycle.
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
 * The two Android manifest changes KRDPASS needs: `singleTask` on the main activity so the
 * redirect returns to the existing task, and `<queries>` entries so Android 11+ package
 * visibility does not hide the KRDPASS app (without them, launching it fails silently).
 * Entries the host app already declares are left alone.
 */
const withAndroidConfig: ConfigPlugin = (config) => {
  return withAndroidManifest(config, (config) => {
    const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(
      config.modResults,
    );
    mainActivity.$["android:launchMode"] = "singleTask";

    const queries = (config.modResults.manifest.queries ??= []);
    const declared = new Set(
      queries.flatMap((query) =>
        (query.package ?? []).map((entry) => entry.$["android:name"]),
      ),
    );

    for (const packageId of ["krd.pass", "krd.pass.dev"]) {
      if (!declared.has(packageId)) {
        queries.push({ package: [{ $: { "android:name": packageId } }] });
      }
    }

    return config;
  });
};

export default createRunOncePlugin(
  withKrdPassAuth,
  packageName,
  packageVersion,
);
