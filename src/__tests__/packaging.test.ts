import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type PackageJson = {
  codegenConfig?: {
    name?: string;
    type?: string;
    jsSrcsDir?: string;
    android?: { javaPackageName?: string };
  };
  files?: string[];
};

describe("package metadata", () => {
  const packageJson = JSON.parse(
    readFileSync(resolve(__dirname, "../../package.json"), "utf8"),
  ) as PackageJson;

  it("publishes the Codegen source and declares its module schema", () => {
    expect(packageJson.files).toEqual(
      expect.arrayContaining(["src", "build"]),
    );
    expect(packageJson.codegenConfig).toEqual({
      name: "KrdpassAuthReactNativeSpec",
      type: "modules",
      jsSrcsDir: "src",
      android: {
        javaPackageName: "krdpass.auth.reactnative",
      },
    });
  });
});
