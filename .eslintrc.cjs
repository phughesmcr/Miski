module.exports = {
  "root": true,
  "env": {
    "browser": true,
    "es2021": true,
    "node": true
  },
  "extends": [
    "plugin:sonarjs/recommended",
    "eslint:recommended",
    "problems",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
    "plugin:prettier/recommended"
  ],
  "overrides": [],
  "parser": "@typescript-eslint/parser",
  "parserOptions": {
    "ecmaVersion": "latest",
    "sourceType": "module",
    "project": "./tsconfig.json",
    "ecmaFeatures": {
      "modules": true
    },
  },
  "plugins": [
    "prettier",
    "@typescript-eslint",
    "eslint-plugin-no-explicit-type-exports",
    "sonarjs"
  ],
  "rules": {
    "@typescript-eslint/member-ordering": ["error"],
    "@typescript-eslint/no-dynamic-delete": ["error"],
    "@typescript-eslint/no-empty-function": ["error"],
    "@typescript-eslint/no-empty-interface": ["error"],
    "@typescript-eslint/no-extra-non-null-assertion": ["error"],
    "@typescript-eslint/no-extra-semi": ["error"],
    "@typescript-eslint/no-unnecessary-boolean-literal-compare": ["error"],
    "@typescript-eslint/no-unnecessary-condition": ["error"],
    "@typescript-eslint/no-unnecessary-qualifier": ["error"],
    "@typescript-eslint/no-unnecessary-type-arguments": ["error"],
    "@typescript-eslint/no-unnecessary-type-assertion": ["error"],
    "@typescript-eslint/no-unused-expressions": ["error"],
    "@typescript-eslint/no-unused-vars": ["error"],
    "@typescript-eslint/no-use-before-define": ["error"],
    "@typescript-eslint/no-useless-constructor": ["error"],
    "class-methods-use-this": ["error"],
    "complexity": ["error"],
    "eol-last": ["error", "always"],
    "indent": ["error", 2],
    "linebreak-style": ["error","unix"],
    "max-depth": ["error"],
    "max-len": ["error", { "code": 120 }],
    "max-lines-per-function": ["error"],
    "max-nested-callbacks": ["error"],
    "max-params": ["error"],
    "max-statements": ["error"],
    "no-delete-var": ["error"],
    "no-dupe-args": ["error"],
    "no-dupe-class-members": ["error"],
    "no-dupe-keys": ["error"],
    "no-duplicate-case": ["error"],
    "no-duplicate-imports": 0,
    "no-duplicate-imports": ["error"],
    "no-empty-character-class": ["error"],
    "no-empty-function": ["error"],
    "no-empty-pattern": ["error"],
    "no-empty": ["error"],
    "no-extra-boolean-cast": ["error"],
    "no-extra-semi": ["error"],
    "no-lone-blocks": ["error"],
    "no-trailing-spaces": "error",
    "no-unreachable": ["error"],
    "no-unused-expressions": ["error"],
    "no-unused-labels": ["error"],
    "no-unused-vars": ["error"],
    "no-use-before-define": "off",
    "no-useless-call": ["error"],
    "no-useless-catch": ["error"],
    "no-useless-concat": ["error"],
    "no-useless-constructor": ["error"],
    "no-useless-escape": ["error"],
    "no-useless-return": ["error"],
    "prettier/prettier": "error",
    "quotes": ["error","double"],
    "semi": ["error", "always"],
    "sonarjs/cognitive-complexity": ["error"],
    "sonarjs/max-switch-cases": ["error"],
    "sonarjs/no-all-duplicated-branches": ["error"],
    "sonarjs/no-duplicated-branches": ["error"],
    "sonarjs/no-element-overwrite": ["error"],
    "sonarjs/no-extra-arguments": ["error"],
    "sonarjs/no-identical-conditions": ["error"],
    "sonarjs/no-identical-expressions": ["error"],
    "sonarjs/no-identical-functions": ["error"],
    "sonarjs/no-one-iteration-loop": ["error"],
    "sonarjs/no-redundant-boolean": ["error"],
    "sonarjs/no-redundant-jump": ["error"],
    "sonarjs/no-unused-collection": ["error"],
    "sonarjs/no-useless-catch": ["error"],
    "sonarjs/prefer-single-boolean-return": 0
  }
}
