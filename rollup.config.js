"use strict";

import babel from "@rollup/plugin-babel";
import commonjs from "@rollup/plugin-commonjs";
import dts from "rollup-plugin-dts";
import fs from "fs";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import * as pkg from "./package.json";
import typescript from "@rollup/plugin-typescript";
import { DEFAULT_EXTENSIONS } from "@babel/core";
import { terser } from "rollup-plugin-terser";

const license = fs.readFileSync("./LICENSE", "utf-8").split(/\r?\n/g).reduce((str, line) => str += ` * ${line}\n`, "");

const pkgName = pkg.name;
const pkgVersion = pkg.version;
const extensions = [...DEFAULT_EXTENSIONS, ".ts", ".tsx"];

// https://rollupjs.org/guide/en#external-e-external
const external = [
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.peerDependencies || {}),
];
const globals = {};

const bannerText =
`/*! *****************************************************************************
 *
 * ${pkgName}
 * v${pkgVersion}
 *
${license}***************************************************************************** */\n`;

const input = "./src/index.ts";

export default [
  // ES2020
  {
    input,

    external,

    plugins: [
      // Allows node_modules resolution
      nodeResolve({
        extensions,
        mainFields: ["module", "main"],
      }),

      // Allow bundling cjs modules. Rollup doesn't understand cjs
      commonjs({
        include: "node_modules/**",
        transformMixedEsModules: true,
       }),

      // Compile TypeScript/JavaScript files
      typescript({
        exclude: [ "node_modules", "*.d.ts", "**/*.d.ts" ],
        include: [ "*.ts+(|x)", "**/*.ts+(|x)", "*.m?js+(|x)", "**/*.m?js+(|x)" ],
        module: "ES2020",
        tsconfig: "tsconfig.json",
        tslib: require("tslib"),
        typescript: require("typescript"),
      }),

      // Minify
      terser({
        ecma: 2020,
        module: true,
        keep_classnames: true,
        keep_fnames: true,
        compress: true,
        mangle: true,
      }),
    ],

    output: [{
      banner: bannerText,
      esModule: true,
      exports: "named",
      file: "./dist/es2020/index.min.js",
      format: "es",
      sourcemap: true,
      globals,
    },
    {
      banner: bannerText,
      esModule: true,
      exports: "named",
      file: "./demo/miski.min.js",
      format: "es",
      sourcemap: false,
      globals,
    }],
  },
  // ESM
  {
    input,

    external,

    plugins: [
      nodeResolve({
        extensions,
        mainFields: ["module", "main"],
      }),

      commonjs({
        include: "node_modules/**",
        transformMixedEsModules: true,
       }),

      typescript({
        exclude: [ "node_modules", "*.d.ts", "**/*.d.ts" ],
        include: [ "*.ts+(|x)", "**/*.ts+(|x)", "*.m?js+(|x)", "**/*.m?js+(|x)" ],
        module: "ES2020",
        tsconfig: "tsconfig.json",
        tslib: require("tslib"),
        typescript: require("typescript"),
      }),

      babel({
        extensions,
        babelHelpers: "bundled",
        include: ["src/**/*"],
        exclude: ["node_modules/**/*"],
      }),

      terser({
        ecma: 2020,
        module: true,
        keep_classnames: true,
        keep_fnames: true,
        compress: true,
        mangle: true,
      }),
    ],

    output: [{
      banner: bannerText,
      esModule: true,
      exports: "named",
      file: pkg.module,
      format: "es",
      sourcemap: true,
      globals,
    }],
  },

  // CJS
  {
    input,

    external,

    plugins: [
      nodeResolve({
        extensions,
        mainFields: ["main", "node"],
      }),

      commonjs({
        include: "node_modules/**",
        transformMixedEsModules: true,
      }),

      typescript({
        exclude: [ "node_modules", "*.d.ts", "**/*.d.ts" ],
        include: [ "*.ts+(|x)", "**/*.ts+(|x)", "*.m?js+(|x)", "**/*.m?js+(|x)" ],
        tsconfig: "tsconfig.json",
        tslib: require("tslib"),
        typescript: require("typescript"),
      }),

      babel({
        extensions,
        babelHelpers: "bundled",
        include: ["src/**/*"],
        exclude: ["node_modules/**/*"],
      }),

      terser({
        ecma: 2020,
        compress: true,
        mangle: true,
      }),
    ],

    output: {
      banner: bannerText,
      esModule: false,
      exports: "named",
      file: pkg.main,
      format: "cjs",
      name: pkgName,
      sourcemap: true,
      globals,
    },
  },

  // UMD
  {
    input,

    external,

    plugins: [
      nodeResolve({
        extensions,
        mainFields: ["browser", "main"],
        browser: true,
      }),

      commonjs({ include: "node_modules/**" }),

      typescript({
        exclude: [ "node_modules", "*.d.ts", "**/*.d.ts" ],
        include: [ "*.ts+(|x)", "**/*.ts+(|x)", "*.m?js+(|x)", "**/*.m?js+(|x)" ],
        tsconfig: "tsconfig.json",
        tslib: require("tslib"),
        typescript: require("typescript"),
      }),

      babel({
        extensions,
        babelHelpers: "bundled",
        include: ["src/**/*"],
        exclude: ["node_modules/**/*"],
      }),

      terser({
        ecma: 2020,
        compress: true,
        mangle: true,
      }),
    ],

    output: {
      banner: bannerText,
      esModule: false,
      exports: "named",
      file: "./dist/umd/index.min.js",
      format: "umd",
      name: pkgName,
      noConflict: true,
      sourcemap: true,
      globals,
    }
  },

  // BROWSER IIFE
  {
    input,

    external,

    plugins: [
      nodeResolve({
        extensions,
        mainFields: ["browser", "main"],
        browser: true,
      }),

      commonjs({
        include: "node_modules/**",
        transformMixedEsModules: true,
      }),

      typescript({
        exclude: [ "node_modules", "*.d.ts", "**/*.d.ts" ],
        include: [ "*.ts+(|x)", "**/*.ts+(|x)", "*.m?js+(|x)", "**/*.m?js+(|x)" ],
        tsconfig: "tsconfig.json",
        tslib: require("tslib"),
        typescript: require("typescript"),
      }),

      babel({
        extensions,
        babelHelpers: "bundled",
        include: ["src/**/*"],
        exclude: ["node_modules/**/*"],
      }),

      terser({
        ecma: 2020,
        compress: true,
        mangle: true,
      }),
    ],

    output: {
      banner: bannerText,
      esModule: false,
      exports: "named",
      file: pkg.browser,
      format: "iife",
      name: pkgName,
      sourcemap: true,
      globals,
    },
  },

  // TYPESCRIPT DECLARATIONS
  {
    input: "./types/index.d.ts",
    output: [
      // CJS
      {
        file: pkg.types,
        format: "es"
      },
      // UMD
      {
        file: "./dist/umd/index.min.d.ts",
        format: "es"
      },
      // Browser
      {
        file: "./dist/iife/index.min.d.ts",
        format: "es"
      },
      // ESM
      {
        file: "./dist/esm/index.min.d.ts",
        format: "es"
      },
      // Demo
      {
        file: "./demo/miski.min.d.ts",
        format: "es"
      },
      // ES2020
      {
        file: "./dist/es2020/index.min.d.ts",
        format: "es"
      },
    ],
    plugins: [
      dts(),
    ],
  },
];
