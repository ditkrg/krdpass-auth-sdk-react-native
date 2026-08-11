import {
  type ConfigPlugin,
  AndroidConfig,
  WarningAggregator,
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
  // iOS needs no Info.plist changes: KRDPASS is Universal Link only, and associated domains
  // are host-app config. The pod source below is the only iOS wiring.
  config = withKrdpassPodSource(config);
  return config;
};

/** Inject the KrdpassAuth pod's git source into the prebuild-generated Podfile. */
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
 */
const withAndroidConfig: ConfigPlugin = (config) => {
  return withAndroidManifest(config, (config) => {
    const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(
      config.modResults,
    );
    const launchMode = mainActivity.$["android:launchMode"];
    if (launchMode && launchMode !== "singleTask") {
      WarningAggregator.addWarningAndroid(
        "krdpass-auth-react-native",
        `Changed the main activity launchMode from "${launchMode}" to "singleTask". KRDPASS needs it to return the redirect to the existing task.`,
      );
    }
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
