"use strict";

import commonjs from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import json from '@rollup/plugin-json';
import typescript from 'rollup-plugin-typescript2';
import dts from "rollup-plugin-dts";
import { terser } from "rollup-plugin-terser";
import * as pkg from "./package.json";

const CURRENT_YEAR = new Date().getFullYear();
const bannerText = `/*! Miski v${pkg.version}. MIT license. (C) 2021-${CURRENT_YEAR} P. Hughes<github@phugh.es>(https://www.phugh.es). All rights reserved. **/\n`;
const extensions = [".js", ".jsx", ".es6", ".es", ".mjs", ".ts", ".tsx"];
const external = [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.peerDependencies || {})];
const globals = {};
const input = "./src/index.ts";

export default [
  {
    input,

    external,

    plugins: [
      nodeResolve({
        extensions,
        mainFields: ["module", "jsnext:main", "main"],
      }),

      commonjs({
        include: "node_modules/**",
        transformMixedEsModules: true,
      }),

      json({
        compact: true,
        preferConst: true,
      }),

      typescript({
        clean: true,
        exclude: [ "node_modules", "*.d.ts", "**/*.d.ts" ],
        include: [ "*.ts+(|x)", "**/*.ts+(|x)", "*.m?js+(|x)", "**/*.m?js+(|x)" ],
        tsconfig: "tsconfig.json",
        tslib: require("tslib"),
        typescript: require("typescript"),
        tsconfigOverride: {
          declaration: false,
        },
        useTsconfigDeclarationDir: true,
      }),

      terser({
        ecma: 2020,
        module: true,
        compress: true,
        mangle: true,
      }),
    ],

    output: [{
      banner: bannerText,
      esModule: true,
      exports: "named",
      file: "./dist/miski.min.js",
      format: "es",
      sourcemap: true,
      globals,
    }],
  },
  {
    input: "./types/src/index.d.ts",
    output: [
      {
        file: "./dist/miski.min.d.ts",
        format: "es"
      },
    ],
    plugins: [
      dts(),
    ],
  },
];
