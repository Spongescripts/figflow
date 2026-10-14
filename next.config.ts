import type { NextConfig } from "next";

/**
 * What the generator copies into each project (see RUNTIME_FILES in src/engine/codegen/project.ts).
 * Only the routes that generate projects get these files: bundling all of runtime/ into every API
 * function made each deploy upload ~15 copies of it.
 */
const runtimeFiles = [
  "./package.json",
  "./runtime/LICENSE.txt",
  "./runtime/ff/**/*",
  "./runtime/ui/**/*",
  "./runtime/fonts/**/*",
  "./runtime/third_party/stb/**/*",
  "./runtime/third_party/imgui/*.{h,cpp,txt}",
  "./runtime/third_party/imgui/backends/imgui_impl_{dx11,win32}.{h,cpp}",
  "./runtime/third_party/imgui/misc/**/*",
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["@resvg/resvg-js", "@wasm-fmt/clang-format", "sharp", "tsx", "yazl"],
  outputFileTracingIncludes: {
    "/api/uploads": runtimeFiles,
    "/api/uploads/\\[id\\]/complete": runtimeFiles,
    "/api/uploads/\\[id\\]/projects": runtimeFiles,
    // Every other API route only needs package.json (paths.ts finds the app folder by it).
    "/api/**/*": ["./package.json"],
  },
  outputFileTracingExcludes: {
    "/**": ["./runtime/tests/**/*", "./runtime/third_party/imgui/imgui_demo.cpp", "./.github/**/*"],
  },
};

export default nextConfig;
