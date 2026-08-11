// Kept out of plugin/src/index.ts because app.plugin.js re-exports that module, so anything
// exported there ships as public API on day one.

// Not on the CocoaPods trunk: the host Podfile needs this git source, tag matching the core.
const KRDPASS_AUTH_POD =
  "pod 'KrdpassAuth', :git => 'https://github.com/ditkrg/krdpass-auth-sdk-ios.git', :tag => 'v1.5.0'";
const POD_BLOCK_START =
  "# @generated begin krdpass-auth-react-native - expo prebuild (DO NOT MODIFY)";
const POD_BLOCK_END =
  "# @generated end krdpass-auth-react-native";

/** Add the iOS core pod to an Expo-generated Podfile, idempotently across prebuilds. */
export function ensureKrdpassAuthPodSource(contents: string): string {
  const lineEnding = contents.includes("\r\n") ? "\r\n" : "\n";
  const hasTrailingLineEnding = contents.endsWith(lineEnding);
  const lines = contents.split(lineEnding);
  if (hasTrailingLineEnding) {
    lines.pop();
  }

  // Any host-managed KrdpassAuth declaration (e.g. a contributor's local :path) wins.
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

  // A hand-written git declaration is rewritten in place rather than duplicated, which
  // CocoaPods would reject.
  const unmarkedGitPodIndex = lines.findIndex(isKrdpassAuthGitPod);
  if (unmarkedGitPodIndex !== -1) {
    lines[unmarkedGitPodIndex] =
      `${leadingWhitespace(lines[unmarkedGitPodIndex])}${KRDPASS_AUTH_POD}`;
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
