/** @type {import("@electron-forge/shared-types").ForgeConfig} */
module.exports = {
  packagerConfig: {
    name: "Execute",
    executableName: "Execute",
    appBundleId: "com.execute.app",
    appCopyright: "© 2026 Maxi Redigonda",
    appCategoryType: "public.app-category.productivity",
    icon: "build/icon", // forge appends .icns on macOS
    asar: true,
    extendInfo: {
      LSApplicationCategoryType: "public.app-category.productivity",
      NSHumanReadableCopyright: "© 2026 Maxi Redigonda",
      // Local-first app: no networking entitlements implied.
      LSMinimumSystemVersion: "11.0",
    },
    // Ship only the Electron shell + built renderer; leave source/tooling out.
    ignore: [
      /^\/\.git($|\/)/,
      /^\/src($|\/)/,
      /^\/assets($|\/)/,
      /^\/scripts($|\/)/,
      /^\/build($|\/)/,
      /^\/node_modules\/\.cache($|\/)/,
      /^\/(tsconfig.*\.json|vite\.config\.ts|tailwind\.config\.ts|postcss\.config\.js)$/,
      /^\/README\.md$/,
      /^\/LICENSE$/,
      /^\/\.npmrc$/,
      /^\/build\.sh$/,
      /^\/index\.html$/,
    ],
    prune: true,
  },
  makers: [
    {
      name: "@electron-forge/maker-dmg",
      config: {
        name: "Execute",
        icon: "build/icon.icns",
        overwrite: true,
        contents: (opts) => [
          { x: 160, y: 190, type: "file", path: opts.appPath },
          { x: 380, y: 190, type: "link", path: "/Applications" },
        ],
        additionalDMGOptions: { window: { size: { width: 540, height: 380 } } },
      },
      platforms: ["darwin"],
    },
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin"],
      config: {},
    },
  ],
};
