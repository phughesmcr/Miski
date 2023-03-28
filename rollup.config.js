"use strict";

import terser from '@rollup/plugin-terser';
import dts from "rollup-plugin-dts";
import replace from '@rollup/plugin-replace';
import typescript from 'rollup-plugin-typescript2';

const VERSION = process.env.npm_package_version;
const CURRENT_YEAR = new Date().getFullYear();
const bannerText = `/*! Miski v${VERSION}. MIT license. (C) 2021-${CURRENT_YEAR} the Miski authors. All rights reserved. **/\n/*! @author P. Hughes<github@phugh.es>(https://www.phugh.es) **/`;
const globals = {};
const input = "./src/index.ts";

export default [
  {
    input,

    treeshake: true,

    plugins: [
      replace({
        exclude: 'node_modules/**',
        values: {
          __VERSION__: VERSION,
        },
        preventAssignment: true,
      }),

      typescript({
        clean: true,
        exclude: [ "node_modules", "*.d.ts", "**/*.d.ts" ],
        include: [ "*.ts+(|x)", "**/*.ts+(|x)", "*.m?js+(|x)", "**/*.m?js+(|x)" ],
        tsconfig: "tsconfig.json",
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
    input: "./build/index.d.ts",
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
