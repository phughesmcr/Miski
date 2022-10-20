module.exports = {
  "root": true,
  "env": {
    "browser": true,
    "es2021": true
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
    "no-duplicate-imports": 0,
    "no-explicit-type-exports/no-explicit-type-exports": 2,
    "prettier/prettier": "error",
    "sonarjs/prefer-single-boolean-return": 0,
    "no-use-before-define": "off",
    "@typescript-eslint/no-use-before-define": ["error"],
    "eol-last": ["error", "always"],
    "indent": ["error", 2],
    "linebreak-style": ["error","unix"],
    "max-len": ["error", { "code": 120 }],
    "no-trailing-spaces": "error",
    "quotes": ["error","double"],
    "semi": ["error", "always"]
  }
}
