"use strict";

import babel from '@rollup/plugin-babel';
import commonjs from '@rollup/plugin-commonjs';
import dts from "rollup-plugin-dts";
import fs from 'fs';
import pkg from './package.json';
import resolve from '@rollup/plugin-node-resolve';
import typescript from 'rollup-plugin-typescript2';
import { DEFAULT_EXTENSIONS } from '@babel/core';
import { terser } from "rollup-plugin-terser";

const license = fs.readFileSync('./LICENSE', 'utf-8').split(/\r?\n/g).reduce((str, line) => str += ` * ${line}\n`, '');

const pkgName = pkg.name;
const pkgVersion = pkg.version;
const extensions = [...DEFAULT_EXTENSIONS, '.ts', '.tsx'];

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

const input = './src/index.ts';

export default [
  // ESM
  {
    input,

    external,

    plugins: [
      // Allows node_modules resolution
      resolve({
        extensions,
        mainFields: ['jsnext:main, module, main'],
      }),

      // Allow bundling cjs modules. Rollup doesn't understand cjs
      commonjs({
        include: 'node_modules/**',
        transformMixedEsModules: true,
       }),

      // Compile TypeScript/JavaScript files
      typescript({
        clean: true,
        exclude: [ "node_modules", "*.d.ts", "**/*.d.ts" ],
        include: [ "*.ts+(|x)", "**/*.ts+(|x)", "*.m?js+(|x)", "**/*.m?js+(|x)" ],
        tsconfig: "tsconfig.json",
        tslib: require('tslib'),
        typescript: require("typescript"),
      }),

      terser({
        ecma: 2021,
        module: true,
        keep_classnames: true,
        keep_fnames: true,
      }),
    ],

    output: {
      banner: bannerText,
      esModule: true,
      exports: 'named',
      file: pkg.module,
      format: "es",
      sourcemap: true,
      globals,
    },
  },

  // CJS
  {
    input,

    external,

    plugins: [
      // Allows node_modules resolution
      resolve({ extensions }),

      // Allow bundling cjs modules. Rollup doesn't understand cjs
      commonjs({ include: 'node_modules/**' }),

      // Compile TypeScript/JavaScript files
      typescript({
        clean: true,
        exclude: [ "node_modules", "*.d.ts", "**/*.d.ts" ],
        include: [ "*.ts+(|x)", "**/*.ts+(|x)", "*.m?js+(|x)", "**/*.m?js+(|x)" ],
        tsconfig: "tsconfig.json",
        module: "cjs",
        tslib: require('tslib'),
        typescript: require("typescript"),
      }),

      terser({
        keep_classnames: true,
        keep_fnames: true,
      }),
    ],

    output: {
      banner: bannerText,
      esModule: false,
      exports: 'named',
      file: pkg.main,
      format: 'cjs',
      sourcemap: true,
      globals,
    },
  },

  // UMD
  {
    input,

    external,

    plugins: [
      resolve({ extensions }),

      commonjs({ include: 'node_modules/**' }),

      babel({
        extensions,
        babelHelpers: 'bundled',
        include: ["src/**/*"],
        exclude: ["node_modules/**/*"],
      }),

      terser(),
    ],

    output: [{
      banner: bannerText,
      esModule: false,
      exports: 'named',
      file: "./dist/umd/index.min.js",
      format: 'umd',
      name: pkgName,
      sourcemap: true,
      globals,
    }]
  },

  // BROWSER IIFE
  {
    input,

    external,

    plugins: [
      resolve({
        extensions,
        browser: true,
      }),

      commonjs({
        include: 'node_modules/**',
        transformMixedEsModules: true,
      }),

      babel({
        extensions,
        babelHelpers: 'bundled',
        include: ["src/**/*"],
        exclude: ["node_modules/**/*"],
      }),

      terser({
        module: false,
        keep_classnames: true,
        keep_fnames: true,
      }),
    ],

    output: [{
      banner: bannerText,
      esModule: false,
      exports: 'named',
      file: pkg.browser,
      format: 'iife',
      name: pkgName,
      sourcemap: true,
      globals,
    }],
  },

  // TYPESCRIPT DECLARATIONS
  {
    input: "./types/index.d.ts",
    output: [
      // CJS
      {
        banner: bannerText,
        file: pkg.types,
        format: "es"
      },
      // UMD
      {
        banner: bannerText,
        file: "./dist/umd/index.min.d.ts",
        format: "es"
      },
      // Browser
      {
        banner: bannerText,
        file: "./dist/iife/index.min.d.ts",
        format: "es"
      },
      // Module
      {
        banner: bannerText,
        file: "./dist/esm/index.min.d.ts",
        format: "es"
      },
    ],
    plugins: [
      dts(),
    ],
  },
];
