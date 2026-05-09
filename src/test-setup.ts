// Polyfill DOMParser for Bun's test runner, which does not ship DOM APIs.
// linkedom is a spec-compliant implementation used only during testing.
import { DOMParser } from "linkedom";

Object.assign(globalThis, { DOMParser });
