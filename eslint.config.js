// Base configuration plus the project's own rules from docs/standard.md.
// Every rule below names the section of docs/standard.md it enforces. The PostToolUse hook
// .claude/hooks/check-edited-file.mjs runs ESLint on each file the agent edits, so these rules
// also stop the agent. `npm run lint` runs them for code written by people.
const js = require("@eslint/js");
const tseslint = require("typescript-eslint");

// Behörighet: the logged-in customer comes from requireCustomer and req.customerId, never from
// the request body or query.
const customerIdFromRequest = [
  {
    selector:
      "MemberExpression[object.type='MemberExpression'][object.property.name=/^(body|query)$/][property.name='customerId']",
    message:
      "Read the logged-in customer from req.customerId (requireCustomer), never from req.body or req.query (docs/standard.md, Behörighet).",
  },
  {
    selector:
      "MemberExpression[object.type='MemberExpression'][object.property.name=/^(body|query)$/][property.value='customerId']",
    message:
      "Read the logged-in customer from req.customerId (requireCustomer), never from req.body or req.query (docs/standard.md, Behörighet).",
  },
  {
    selector:
      "VariableDeclarator[init.property.name=/^(body|query)$/] > ObjectPattern > Property[key.name='customerId']",
    message:
      "Read the logged-in customer from req.customerId (requireCustomer), never from req.body or req.query (docs/standard.md, Behörighet).",
  },
];

// Pengar: all price calculation goes through calcPrice in src/pricing/.
const priceArithmetic = [
  {
    selector:
      "BinaryExpression[operator=/^[-+*\\/]$/] MemberExpression[property.name=/^(unit_price|unitPrice)$/]",
    message:
      "Do not calculate prices here. Use calcPrice from src/pricing/ (docs/standard.md, Pengar).",
  },
];

// Fel: the service layer returns Result with ok/err for expected cases instead of throwing.
// Re-throwing a caught error (`throw e`) after a rollback is still allowed.
const throwNewInServices = [
  {
    selector: "ThrowStatement[argument.type='NewExpression']",
    message:
      "Return err(code, message) from src/result.ts instead of throwing (docs/standard.md, Fel).",
  },
];

// Fel: routes translate results to HTTP with sendResult or sendError from src/http.ts.
const responsesInRoutes = [
  {
    selector:
      "CallExpression[callee.type='MemberExpression'][callee.object.name='res'][callee.property.name=/^(status|json|send|sendStatus)$/]",
    message:
      "Send responses with sendResult or sendError from src/http.ts (docs/standard.md, Fel).",
  },
];

module.exports = tseslint.config(
  { ignores: ["dist/", "node_modules/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Namn: camelCase for functions and variables, PascalCase for types.
  // UPPER_CASE is allowed for module constants such as STATUS in src/http.ts.
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    rules: {
      "@typescript-eslint/naming-convention": [
        "error",
        { selector: "variable", format: ["camelCase", "UPPER_CASE"] },
        { selector: "function", format: ["camelCase"] },
        { selector: "typeLike", format: ["PascalCase"] },
      ],
    },
  },
  // Namn: fields in JSON responses are camelCase, renamed in SQL with AS "fieldName".
  // Only in src/: tests may describe raw database rows, such as information_schema columns.
  {
    files: ["src/**/*.ts"],
    rules: {
      "@typescript-eslint/naming-convention": [
        "error",
        { selector: "variable", format: ["camelCase", "UPPER_CASE"] },
        { selector: "function", format: ["camelCase"] },
        { selector: "typeLike", format: ["PascalCase"] },
        { selector: "typeProperty", format: ["camelCase"] },
      ],
    },
  },

  // Pengar: amounts are never calculated with floating point.
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "parseFloat",
          message: "Amounts are never calculated with floating point (docs/standard.md, Pengar).",
        },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "Number",
          property: "parseFloat",
          message: "Amounts are never calculated with floating point (docs/standard.md, Pengar).",
        },
      ],
    },
  },

  // Hemligheter och loggar: no personal data in logs. src/server.ts keeps its startup message.
  {
    files: ["src/**/*.ts"],
    ignores: ["src/server.ts"],
    rules: { "no-console": "error" },
  },

  // no-restricted-syntax is replaced, not merged, by a later matching block, so each block
  // below lists every selector that applies to its files.
  {
    files: ["src/**/*.ts"],
    ignores: ["src/pricing/**"],
    rules: { "no-restricted-syntax": ["error", ...customerIdFromRequest, ...priceArithmetic] },
  },
  {
    files: ["src/services/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...customerIdFromRequest,
        ...priceArithmetic,
        ...throwNewInServices,
      ],
    },
  },
  {
    files: ["src/routes/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...customerIdFromRequest,
        ...priceArithmetic,
        ...responsesInRoutes,
      ],
    },
  },
);
