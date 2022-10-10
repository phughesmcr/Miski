export default [{
  "root": true,
  "parser": "@typescript-eslint/parser",
  "parserOptions": {
    "ecmaVersion": "latest",
    "ecmaFeatures": {
      "modules": true
    },
    "sourceType": "module",
    "project": "./tsconfig.json"
  },
  "plugins": [
    "prettier",
    "@typescript-eslint",
    "eslint-plugin-no-explicit-type-exports",
    "sonarjs"
  ],
  "extends": [
    "plugin:sonarjs/recommended",
    "eslint:recommended",
    "problems",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
    "plugin:prettier/recommended"
  ],
  "env": {
    "es2021": true,
    "node": true,
    "browser": true
  },
  "rules": {
    "no-explicit-type-exports/no-explicit-type-exports": 2,
    "prettier/prettier": "error",
    "sonarjs/prefer-single-boolean-return": 0,
    "no-use-before-define": "off",
    "@typescript-eslint/no-use-before-define": ["error"]
  },
  "ignores": [
    "/*",
    "!/src"
  ]
}]