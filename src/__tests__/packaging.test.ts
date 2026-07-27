import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type PackageJson = {
  version?: string;
  codegenConfig?: {
    name?: string;
    type?: string;
    jsSrcsDir?: string;
    android?: { javaPackageName?: string };
  };
  files?: string[];
  exports?: Record<string, unknown>;
};

describe("package metadata", () => {
  const packageJson = JSON.parse(
    readFileSync(resolve(__dirname, "../../package.json"), "utf8"),
  ) as PackageJson;

  // These assert cross-file invariants, not that package.json equals a copy of itself.
  // Each one fails only when the manifest and something outside it disagree.

  it("ships the directory Codegen is told to read", () => {
    // jsSrcsDir must be inside `files`, or the published tarball has a codegenConfig
    // pointing at sources that were never packed and Codegen produces an empty spec.
    const jsSrcsDir = packageJson.codegenConfig?.jsSrcsDir;
    expect(jsSrcsDir).toBeDefined();
    expect(packageJson.files).toEqual(expect.arrayContaining([jsSrcsDir!]));
  });

  it("ships the build output its main and types entries point at", () => {
    expect(packageJson.files).toEqual(expect.arrayContaining(["build"]));
  });

  it("declares an Android package name matching the native module's source tree", () => {
    // A mismatch here compiles on both sides and fails at runtime with an unresolved
    // TurboModule, which is expensive to diagnose.
    const javaPackageName = packageJson.codegenConfig?.android?.javaPackageName;
    expect(javaPackageName).toBeDefined();
    const sourceDir = resolve(
      __dirname,
      "../../android/src/main/java",
      javaPackageName!.split(".").join("/"),
    );
    expect(existsSync(sourceDir)).toBe(true);
  });

  it("exposes only the package root, so build/ and src/ are not deep-importable", () => {
    // Without an exports map every internal module becomes a semver commitment, and
    // adding the map later is itself a breaking change.
    expect(packageJson.exports).toBeDefined();
    expect(Object.keys(packageJson.exports!).sort()).toEqual([
      ".",
      "./app.plugin.js",
      "./package.json",
    ]);
  });
});

describe("version is bumped everywhere or nowhere", () => {
  // The version is hardcoded in eight files outside package.json, and release.yml only
  // checks the git tag against package.json. A bump that misses android/build.gradle ships
  // an RN wrapper pinned to a stale native core with green CI. This is the check that fails.
  const version = JSON.parse(
    readFileSync(resolve(__dirname, "../../package.json"), "utf8"),
  ).version as string;

  const expectedStrings: Record<string, string[]> = {
    "android/build.gradle": [
      `version = '${version}'`,
      `versionName = "${version}"`,
      `implementation "krd.pass:krdpass-auth:${version}"`,
    ],
    "krdpass-auth-react-native.podspec": [
      `tag: 'v${version}'`,
      `s.dependency 'KrdpassAuth', '${version}'`,
    ],
    "plugin/src/podfile.ts": [`:tag => 'v${version}'`],
    "plugin/src/__tests__/podfile.test.ts": [`:tag => 'v${version}'`],
    "scripts/verify-consumer.mjs": [`:tag => 'v${version}'`],
    "README.md": [
      `krdpass-auth-sdk-react-native#v${version}`,
      `:tag => 'v${version}'`,
    ],
  };

  it("declares a version", () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it.each(Object.entries(expectedStrings))(
    "%s pins the package.json version",
    (file, needles) => {
      const contents = readFileSync(resolve(__dirname, "../..", file), "utf8");
      for (const needle of needles) {
        expect({ file, needle, found: contents.includes(needle) }).toEqual({
          file,
          needle,
          found: true,
        });
      }
    },
  );
});
