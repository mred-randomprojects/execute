/** @type {import("@electron-forge/shared-types").ForgeConfig} */
module.exports = {
  packagerConfig: {
    name: "Execute",
    executableName: "Execute",
    appBundleId: "com.execute.app",
    asar: true,
    // Ship only the Electron shell + built renderer; leave source/tooling out.
    ignore: [
      /^\/\.git($|\/)/,
      /^\/src($|\/)/,
      /^\/node_modules\/\.cache($|\/)/,
      /^\/(tsconfig.*\.json|vite\.config\.ts|tailwind\.config\.ts|postcss\.config\.js)$/,
      /^\/README\.md$/,
      /^\/\.npmrc$/,
      /^\/index\.html$/,
    ],
    prune: true,
  },
  makers: [
    {
      name: "@electron-forge/maker-dmg",
      config: {
        name: "Execute",
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
