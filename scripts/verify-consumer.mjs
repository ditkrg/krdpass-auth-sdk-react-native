#!/usr/bin/env node

import { cpSync, mkdtempSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// These are deliberately exact: consumer verification must not drift when a
// generator or its template publishes a new release.
const BARE_REACT_NATIVE_VERSION = "0.86.0";
const REACT_NATIVE_CLI_VERSION = "20.2.0";
const CREATE_EXPO_APP_VERSION = "4.0.0";
const EXPO_MANAGED_TEMPLATE = "expo-template-blank@57.0.0";
const PACKAGE_NAME = "krdpass-auth-react-native";
const KRDPASS_AUTH_POD =
  "pod 'KrdpassAuth', :git => 'https://github.com/ditkrg/krdpass-auth-sdk-ios.git', :tag => 'v1.5.0'";

const sdkRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

function fail(message) {
  throw new Error(message);
}

function command(commandName, args, { cwd = sdkRoot, capture = false } = {}) {
  process.stdout.write(`\n$ ${commandName} ${args.join(" ")}\n`);
  const result = spawnSync(commandName, args, {
    cwd,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    fail(`${commandName} exited with status ${result.status ?? "unknown"}.`);
  }
  return result.stdout;
}

function parseArguments() {
  const args = process.argv.slice(2);
  // --unit-tests takes no kind/platform: the Android module's JVM tests only run inside the
  // bare consumer, which is the one fixture with a complete Gradle setup for them.
  if (args.includes("--unit-tests")) {
    return { kind: "bare", platform: "android", unitTests: true };
  }
  const valueFor = (flag) => {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
  };
  const kind = valueFor("--kind");
  const platform = valueFor("--platform");
  if (!["bare", "expo"].includes(kind) || !["android", "ios"].includes(platform)) {
    fail("Usage: node scripts/verify-consumer.mjs --kind <bare|expo> --platform <android|ios>\n       node scripts/verify-consumer.mjs --unit-tests");
  }
  return { kind, platform, unitTests: false };
}

function requireFile(path) {
  if (!existsSync(path)) fail(`Expected ${path} to exist. Run npm run build before consumer verification.`);
}

function packSdk(tempRoot) {
  requireFile(join(sdkRoot, "build", "index.js"));
  requireFile(join(sdkRoot, "plugin", "build", "index.js"));
  const packDirectory = join(tempRoot, "package");
  mkdirSync(packDirectory);
  const output = command(
    npm,
    ["pack", "--ignore-scripts", "--json", "--pack-destination", packDirectory],
    { capture: true },
  );
  const packed = JSON.parse(output);
  if (!Array.isArray(packed) || packed.length !== 1 || !packed[0].filename) {
    fail("npm pack did not report exactly one package tarball.");
  }
  const tarball = join(packDirectory, packed[0].filename);
  requireFile(tarball);
  return tarball;
}

function installSdk(consumerRoot, tarball) {
  command(npm, ["install", "--save-exact", "--no-audit", "--no-fund", tarball], { cwd: consumerRoot });
}

function verifyBareAutolinking(consumerRoot) {
  const output = command(npx, ["react-native", "config"], { cwd: consumerRoot, capture: true });
  const config = JSON.parse(output);
  const dependency = config.dependencies?.[PACKAGE_NAME];
  if (!dependency?.platforms?.android || !dependency?.platforms?.ios) {
    fail("React Native autolinking did not discover Android and iOS platforms for the packed SDK.");
  }
}

function prepareBareIosConsumer(consumerRoot) {
  const podfilePath = join(consumerRoot, "ios", "Podfile");
  let podfile = readFileSync(podfilePath, "utf8");
  const platform = /^\s*platform\s+:ios\s*,[^\n]*$/m;
  podfile = platform.test(podfile)
    ? podfile.replace(platform, "platform :ios, '15.5'")
    : `platform :ios, '15.5'\n\n${podfile}`;

  if (!podfile.includes(KRDPASS_AUTH_POD)) {
    const target = /^target\s+['"][^'"]+['"]\s+do\s*$/m.exec(podfile);
    if (!target) fail("Could not find an iOS target in the bare consumer Podfile.");
    const insertionPoint = target.index + target[0].length;
    podfile = `${podfile.slice(0, insertionPoint)}\n  ${KRDPASS_AUTH_POD}${podfile.slice(insertionPoint)}`;
  }
  writeFileSync(podfilePath, podfile);
}

function verifyBareIosConfiguration(consumerRoot) {
  const podfile = readFileSync(join(consumerRoot, "ios", "Podfile"), "utf8");
  if (!/^\s*platform\s+:ios\s*,\s*['"]15\.5['"]\s*$/m.test(podfile)) {
    fail("Bare consumer Podfile did not set the documented iOS 15.5 deployment target.");
  }
  if (!podfile.includes(KRDPASS_AUTH_POD)) {
    fail("Bare consumer Podfile did not contain the documented KrdpassAuth pod source.");
  }
}

function createBareConsumer(consumerRoot, tarball, { ios }) {
  command(
    npx,
    [
      "--yes",
      `@react-native-community/cli@${REACT_NATIVE_CLI_VERSION}`,
      "init",
      "KrdpassAuthBareConsumer",
      "--directory",
      consumerRoot,
      "--version",
      BARE_REACT_NATIVE_VERSION,
      "--package-name",
      "com.krdpass.auth.consumer",
      "--skip-install",
      "--skip-git-init",
    ],
    { cwd: dirname(consumerRoot) },
  );
  installSdk(consumerRoot, tarball);
  // Skipped on the --unit-tests path: that job runs Gradle on Linux and never touches CocoaPods,
  // so editing the Podfile there verifies nothing.
  if (ios) {
    prepareBareIosConsumer(consumerRoot);
    verifyBareIosConfiguration(consumerRoot);
  }
  verifyBareAutolinking(consumerRoot);
}

function addExpoPlugin(consumerRoot) {
  const appJsonPath = join(consumerRoot, "app.json");
  const appJson = JSON.parse(readFileSync(appJsonPath, "utf8"));
  const plugins = appJson.expo?.plugins ?? [];
  if (!plugins.includes(PACKAGE_NAME)) plugins.push(PACKAGE_NAME);
  appJson.expo.plugins = plugins;
  writeFileSync(appJsonPath, `${JSON.stringify(appJson, null, 2)}\n`);
}

function verifyExpoPlugin(consumerRoot) {
  const manifest = readFileSync(join(consumerRoot, "android", "app", "src", "main", "AndroidManifest.xml"), "utf8");
  if (!/android:launchMode="singleTask"/.test(manifest) || !/android:name="krd\.pass(?:\.dev)?"/.test(manifest)) {
    fail("Expo config plugin did not apply the expected Android manifest changes.");
  }
  const podfile = readFileSync(join(consumerRoot, "ios", "Podfile"), "utf8");
  if (!podfile.includes(KRDPASS_AUTH_POD)) {
    fail("Expo config plugin did not add the KrdpassAuth pod source.");
  }
}

function createExpoConsumer(consumerRoot, tarball) {
  command(
    npx,
    [
      "--yes",
      `create-expo-app@${CREATE_EXPO_APP_VERSION}`,
      consumerRoot,
      "--template",
      EXPO_MANAGED_TEMPLATE,
      "--no-install",
      "--no-agents-md",
      "--yes",
    ],
    { cwd: dirname(consumerRoot) },
  );
  installSdk(consumerRoot, tarball);
  addExpoPlugin(consumerRoot);
  command(npx, ["expo", "prebuild", "--clean", "--no-install"], { cwd: consumerRoot });
  verifyExpoPlugin(consumerRoot);
}

function buildAndroid(consumerRoot) {
  const gradlew = join(consumerRoot, "android", "gradlew");
  requireFile(gradlew);
  command(gradlew, ["--no-daemon", ":app:assembleDebug"], {
    cwd: join(consumerRoot, "android"),
  });
}

/**
 * Runs the Android module's JVM tests (BridgeMappingTest) inside the consumer, which is the
 * only place with a complete Gradle setup for them. The tests are not packed into the tarball,
 * so they are copied into the installed module first.
 */
function runAndroidUnitTests(consumerRoot) {
  const gradlew = join(consumerRoot, "android", "gradlew");
  requireFile(gradlew);
  cpSync(
    join(sdkRoot, "android", "src", "test"),
    join(consumerRoot, "node_modules", PACKAGE_NAME, "android", "src", "test"),
    { recursive: true },
  );
  // The Gradle path a library is linked at is its package name, cleansed of the
  // characters Gradle rejects (see nameCleansed in the React Native Gradle plugin). Nothing in
  // this one needs cleansing.
  command(gradlew, ["--no-daemon", `:${PACKAGE_NAME}:testDebugUnitTest`], {
    cwd: join(consumerRoot, "android"),
  });
}

function buildIos(consumerRoot) {
  const iosRoot = join(consumerRoot, "ios");
  command("pod", ["install", "--repo-update"], { cwd: iosRoot });
  const projectName = basename(consumerRoot);
  requireFile(join(iosRoot, `${projectName}.xcworkspace`));
  command(
    "xcodebuild",
    [
      "-workspace",
      `${projectName}.xcworkspace`,
      "-scheme",
      projectName,
      "-configuration",
      "Debug",
      "-sdk",
      "iphonesimulator",
      "-destination",
      "generic/platform=iOS Simulator",
      "CODE_SIGNING_ALLOWED=NO",
      "build",
    ],
    { cwd: iosRoot },
  );
}

const { kind, platform, unitTests } = parseArguments();
const tempRoot = mkdtempSync(join(tmpdir(), "krdpass-auth-consumer-"));
const consumerRoot = join(tempRoot, kind === "bare" ? "KrdpassAuthBareConsumer" : "KrdpassAuthExpoConsumer");

try {
  const tarball = packSdk(tempRoot);
  if (kind === "bare") createBareConsumer(consumerRoot, tarball, { ios: !unitTests });
  else createExpoConsumer(consumerRoot, tarball);
  if (unitTests) runAndroidUnitTests(consumerRoot);
  else if (platform === "android") buildAndroid(consumerRoot);
  else buildIos(consumerRoot);
  process.stdout.write(
    `\n${kind} ${platform} ${unitTests ? "unit tests" : "consumer verification"} passed.\n`,
  );
} finally {
  if (process.env.KEEP_CONSUMER === "1") {
    process.stdout.write(`Keeping consumer fixture at ${tempRoot}\n`);
  } else {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}
