import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier/flat";

export default tseslint.config(
	{
		ignores: ["node_modules/**", "coverage/**", "dist/**", "*.tgz", "*.tsbuildinfo"],
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ["src/**/*.ts", "tests/**/*.ts"],
		languageOptions: {
			parserOptions: {
				projectService: true,
			},
		},
	},
	{
		files: ["tests/**/*.ts"],
		rules: {
			"@typescript-eslint/no-explicit-any": "off",
		},
		languageOptions: {
			globals: {
				describe: "readonly",
				expect: "readonly",
				it: "readonly",
				vi: "readonly",
			},
		},
	},
	prettier,
);
